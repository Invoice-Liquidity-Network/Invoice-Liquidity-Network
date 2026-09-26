#!/usr/bin/env node

/**
 * Indexer export & pagination load test (issue #1042).
 *
 * Stress-tests the resource-exhaustion protections on the bulk-export
 * surface under concurrency:
 *   - GET /v1/export/invoices  — streaming sessions with `?cursor=` follow-through
 *   - GET /v1/export/events    — same, events stream
 *   - GET /v1/invoices?limit&cursor — standard paginated reads
 *   - POST /v1/export/jobs + poll + download — async job lifecycle
 *
 * Asserts the server stays within capacity: error rate, p95 latency, and a
 * server memory ceiling sampled from /metrics (process RSS). A truncated
 * response that omits its resumption cursor is treated as a protocol
 * violation and fails the run.
 *
 * The indexer rate-limits per IP (default 100 req/min). For meaningful
 * results run the server with a raised limit, e.g.:
 *   RATE_LIMIT_MAX=100000 pnpm --filter indexer start
 *
 * Usage:
 *   pnpm test:load:export [--url http://localhost:3001] [--duration 30]
 *                         [--concurrency 10] [--p95 2000] [--error-rate 5]
 *                         [--rss-ceiling-mb 512]
 */

import { calculatePercentiles, colors } from './lib/load-test-harness';

// ── Config ───────────────────────────────────────────────────────────────────

interface ExportLoadConfig {
  url: string;
  durationSeconds: number;
  concurrency: number;
  p95ThresholdMs: number;
  errorRateThresholdPct: number;
  rssCeilingBytes: number;
  gapMs: number;
  requestTimeoutMs: number;
}

function parseArgs(argv: string[]): Partial<ExportLoadConfig> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[arg.slice(2)] = argv[++i];
    }
  }
  const num = (key: string): number | undefined =>
    out[key] !== undefined ? Number(out[key]) : undefined;
  return {
    url: out.url,
    durationSeconds: num('duration'),
    concurrency: num('concurrency'),
    p95ThresholdMs: num('p95'),
    errorRateThresholdPct: num('error-rate'),
    rssCeilingBytes: out['rss-ceiling-mb'] !== undefined
      ? Number(out['rss-ceiling-mb']) * 1024 * 1024
      : undefined,
  };
}

// ── Metrics collection ───────────────────────────────────────────────────────

interface RequestRecord {
  scenario: string;
  method: string;
  path: string;
  latencyMs: number;
  status: number;
  success: boolean;
  bytes: number;
  error?: string;
}

const records: RequestRecord[] = [];

const counters = {
  exportSessions: 0,
  exportPagesTruncated: 0,
  exportBudgetRefusals: 0, // 413 from the per-session row budget — enforcement working, not failure
  protocolViolations: 0, // truncated response without a resumption cursor
  paginationFollowThroughs: 0,
  jobsCreated: 0,
  jobsRejected: 0, // 413 capacity refusals — correct behavior, not failure
  jobsFailed: 0, // unexpected 'failed' status
  rateLimited: 0, // HTTP 429 — client exceeded its own budget, not a server fault
  serverRssBytesMax: 0,
  serverRssSamples: 0,
};

async function timedFetch(
  scenario: string,
  method: string,
  url: string,
  path: string,
  init: RequestInit = {},
  timeoutMs: number
): Promise<{ record: RequestRecord; res?: Response; body?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.text();
    const latencyMs = Date.now() - started;
    const record: RequestRecord = {
      scenario,
      method,
      path,
      latencyMs,
      status: res.status,
      success: res.ok,
      bytes: Buffer.byteLength(body),
    };
    records.push(record);
    if (res.status === 429) counters.rateLimited++;
    return { record, res, body };
  } catch (err: any) {
    const latencyMs = Date.now() - started;
    const error = err?.name === 'AbortError' ? 'Timeout' : err?.message ?? String(err);
    records.push({
      scenario,
      method,
      path,
      latencyMs,
      status: 0,
      success: false,
      bytes: 0,
      error,
    });
    return { record: records[records.length - 1] };
  } finally {
    clearTimeout(timer);
  }
}

// ── Scenarios ────────────────────────────────────────────────────────────────

const MAX_PAGES_PER_SESSION = 25;

/**
 * Streamed export session: request the first page, then follow
 * X-Export-Resumption-Cursor while X-Export-Truncated is set. A truncated
 * page without a cursor is a protocol violation — the client could not
 * resume, so the protection layer would silently drop data.
 */
async function runExportSession(
  cfg: ExportLoadConfig,
  resource: 'invoices' | 'events'
): Promise<void> {
  const format = Math.random() < 0.5 ? 'csv' : 'json';
  let cursor: string | undefined;
  counters.exportSessions++;
  for (let page = 0; page < MAX_PAGES_PER_SESSION; page++) {
    const qs = new URLSearchParams({ format });
    if (cursor) qs.set('cursor', cursor);
    const path = `/v1/export/${resource}?${qs.toString()}`;
    const { record, res } = await timedFetch(
      `export-${resource}`,
      'GET',
      `${cfg.url}${path}`,
      `/v1/export/${resource}`,
      {},
      cfg.requestTimeoutMs
    );
    if (!res) return;
    if (res.status === 413) {
      // The per-session / per-response 413 is the resource-exhaustion
      // protection doing its job — count it as a correct refusal, not an error.
      counters.exportBudgetRefusals++;
      record.success = true;
      return;
    }
    if (!res.ok) return;
    const truncated = res.headers.get('x-export-truncated') === 'true';
    if (!truncated) return;
    counters.exportPagesTruncated++;
    cursor = res.headers.get('x-export-resumption-cursor') ?? undefined;
    if (!cursor) {
      counters.protocolViolations++;
      return;
    }
  }
}

async function runPagination(cfg: ExportLoadConfig): Promise<void> {
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const path = `/v1/invoices?${qs.toString()}`;
    const { body } = await timedFetch(
      'pagination',
      'GET',
      `${cfg.url}${path}`,
      '/v1/invoices',
      {},
      cfg.requestTimeoutMs
    );
    if (body === undefined) return;
    let parsed: { hasMore?: boolean; nextCursor?: string | null };
    try {
      parsed = JSON.parse(body);
    } catch {
      return;
    }
    if (!parsed.hasMore || !parsed.nextCursor) {
      if (page > 0) counters.paginationFollowThroughs++;
      return;
    }
    cursor = parsed.nextCursor;
  }
  counters.paginationFollowThroughs++;
}

const JOB_POLL_INTERVAL_MS = 250;
const JOB_POLL_TIMEOUT_MS = 10_000;

async function runJobLifecycle(cfg: ExportLoadConfig): Promise<void> {
  const create = await timedFetch(
    'job-create',
    'POST',
    `${cfg.url}/v1/export/jobs`,
    '/v1/export/jobs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invoices', format: Math.random() < 0.5 ? 'csv' : 'json' }),
    },
    cfg.requestTimeoutMs
  );
  if (!create.res || !create.body) return;
  if (create.res.status === 413) {
    counters.jobsRejected++;
    create.record.success = true; // correct capacity refusal, not an error
    return;
  }
  if (!create.res.ok) return;
  counters.jobsCreated++;
  let jobId: string;
  try {
    jobId = JSON.parse(create.body).jobId;
  } catch {
    return;
  }

  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
  let status = 'pending';
  while (Date.now() < deadline) {
    const poll = await timedFetch(
      'job-poll',
      'GET',
      `${cfg.url}/v1/export/jobs/${jobId}`,
      '/v1/export/jobs/:jobId',
      {},
      cfg.requestTimeoutMs
    );
    if (!poll.res || !poll.body) return;
    try {
      status = JSON.parse(poll.body).status;
    } catch {
      return;
    }
    if (status === 'done' || status === 'failed') break;
    await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS));
  }
  if (status === 'failed') {
    counters.jobsFailed++;
    return;
  }
  await timedFetch(
    'job-download',
    'GET',
    `${cfg.url}/v1/export/download/${jobId}`,
    '/v1/export/download/:jobId',
    {},
    cfg.requestTimeoutMs
  );
}

// ── Server memory sampling ───────────────────────────────────────────────────

async function sampleServerRss(cfg: ExportLoadConfig, stop: () => boolean): Promise<void> {
  while (!stop()) {
    try {
      const res = await fetch(`${cfg.url}/metrics`, { signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      const match =
        /^iln_process_resident_memory_bytes\s+([0-9.]+)/m.exec(text) ??
        /^process_resident_memory_bytes\s+([0-9.]+)/m.exec(text);
      if (match) {
        counters.serverRssSamples++;
        counters.serverRssBytesMax = Math.max(counters.serverRssBytesMax, Number(match[1]));
      }
    } catch {
      // sampling is best-effort; failure surfaces as "no RSS data" in the report
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ── Reporting ────────────────────────────────────────────────────────────────

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function printSummary(cfg: ExportLoadConfig, elapsedSec: number): string[] {
  const total = records.length;
  const failed = records.filter((r) => !r.success).length;
  const errorRate = total > 0 ? (failed / total) * 100 : 0;
  const percentiles = calculatePercentiles(records.map((r) => r.latencyMs));
  const bytesTotal = records.reduce((a, r) => a + r.bytes, 0);

  console.log(`${colors.bright}${colors.cyan}=== INDEXER EXPORT LOAD TEST ===${colors.reset}`);
  console.log(`Target:            ${cfg.url}`);
  console.log(`Duration:          ${elapsedSec.toFixed(1)}s (configured ${cfg.durationSeconds}s)`);
  console.log(`Concurrency:       ${cfg.concurrency} virtual users`);
  console.log(`Total requests:    ${total}`);
  console.log(`Error rate:        ${fmtPct(errorRate)} (threshold ${cfg.errorRateThresholdPct}%)`);
  console.log(`Throughput:        ${(total / Math.max(elapsedSec, 0.001)).toFixed(1)} req/s`);
  console.log(`Payload streamed:  ${(bytesTotal / 1024 / 1024).toFixed(1)} MB`);
  console.log();
  console.log(`${colors.bright}${colors.cyan}=== LATENCY (ms) ===${colors.reset}`);
  console.log(
    `avg=${percentiles.avg.toFixed(1)} p50=${percentiles.p50} p90=${percentiles.p90} ` +
      `p95=${percentiles.p95} (threshold ${cfg.p95ThresholdMs}) p99=${percentiles.p99} max=${percentiles.max}`
  );
  console.log();

  console.log(`${colors.bright}${colors.cyan}=== EXPORT PROTECTION SIGNALS ===${colors.reset}`);
  console.log(`Export sessions:            ${counters.exportSessions}`);
  console.log(`Truncated pages resumed:    ${counters.exportPagesTruncated}`);
  console.log(`Session budget 413s:        ${counters.exportBudgetRefusals}`);
  console.log(`Protocol violations:        ${counters.protocolViolations}`);
  console.log(`Pagination follow-throughs: ${counters.paginationFollowThroughs}`);
  console.log(`Jobs created:               ${counters.jobsCreated}`);
  console.log(`Jobs refused (413):         ${counters.jobsRejected}`);
  console.log(`Jobs failed unexpectedly:   ${counters.jobsFailed}`);
  console.log(`429 rate-limited requests:  ${counters.rateLimited}`);
  console.log();

  console.log(`${colors.bright}${colors.cyan}=== PER-SCENARIO ===${colors.reset}`);
  const byScenario = new Map<string, RequestRecord[]>();
  for (const r of records) {
    if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, []);
    byScenario.get(r.scenario)!.push(r);
  }
  for (const [name, rs] of Array.from(byScenario.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const p = calculatePercentiles(rs.map((r) => r.latencyMs));
    const errs = rs.filter((r) => !r.success).length;
    console.log(
      name.padEnd(20) +
        ` n=${String(rs.length).padStart(6)}` +
        ` err=${fmtPct((errs / rs.length) * 100).padStart(8)}` +
        ` p95=${String(p.p95).padStart(7)}ms` +
        ` max=${String(p.max).padStart(7)}ms` +
        ` bytes=${(rs.reduce((a, r) => a + r.bytes, 0) / 1024 / 1024).toFixed(1)}MB`
    );
  }
  console.log();
  if (counters.serverRssSamples > 0) {
    console.log(
      `${colors.bright}${colors.cyan}=== SERVER MEMORY ===${colors.reset} ` +
        `peak RSS ${(counters.serverRssBytesMax / 1024 / 1024).toFixed(1)} MB ` +
        `(${counters.serverRssSamples} samples, ceiling ${(cfg.rssCeilingBytes / 1024 / 1024).toFixed(0)} MB)`
    );
  } else {
    console.log(
      `${colors.yellow}No process RSS metrics exposed at /metrics — memory ceiling not enforced.${colors.reset}`
    );
  }
  console.log();

  const violations: string[] = [];
  if (errorRate > cfg.errorRateThresholdPct) {
    violations.push(`Error rate ${fmtPct(errorRate)} exceeds threshold ${cfg.errorRateThresholdPct}%`);
  }
  if (percentiles.p95 > cfg.p95ThresholdMs) {
    violations.push(`p95 latency ${percentiles.p95}ms exceeds threshold ${cfg.p95ThresholdMs}ms`);
  }
  if (counters.protocolViolations > 0) {
    violations.push(`${counters.protocolViolations} truncated export response(s) missing X-Export-Resumption-Cursor`);
  }
  if (counters.jobsFailed > 0) {
    violations.push(`${counters.jobsFailed} async export job(s) failed unexpectedly`);
  }
  if (counters.serverRssSamples > 0 && counters.serverRssBytesMax > cfg.rssCeilingBytes) {
    violations.push(
      `Server RSS ${(counters.serverRssBytesMax / 1024 / 1024).toFixed(1)}MB exceeds ceiling ${(cfg.rssCeilingBytes / 1024 / 1024).toFixed(0)}MB`
    );
  }

  if (violations.length > 0) {
    console.log(`${colors.bright}${colors.red}=== THRESHOLD ALERTS ===${colors.reset}`);
    for (const v of violations) console.log(`${colors.red}[ALERT] ${v}${colors.reset}`);
    console.log();
  } else {
    console.log(`${colors.bright}${colors.green}All export-capacity thresholds satisfied.${colors.reset}\n`);
  }
  return violations;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const overrides = parseArgs(process.argv.slice(2));
  const cfg: ExportLoadConfig = {
    url: (overrides.url ?? process.env.INDEXER_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
    durationSeconds: overrides.durationSeconds ?? 30,
    concurrency: overrides.concurrency ?? 10,
    p95ThresholdMs: overrides.p95ThresholdMs ?? 2000,
    errorRateThresholdPct: overrides.errorRateThresholdPct ?? 5,
    rssCeilingBytes: overrides.rssCeilingBytes ?? 512 * 1024 * 1024,
    gapMs: 10,
    requestTimeoutMs: 30_000,
  };

  const health = await timedFetch('precheck', 'GET', `${cfg.url}/v1/health`, '/v1/health', {}, 5000);
  if (!health.res?.ok) {
    console.error(
      `${colors.red}Indexer not reachable at ${cfg.url} (start it with RATE_LIMIT_MAX raised, see header comment).${colors.reset}`
    );
    process.exit(1);
  }
  records.pop(); // keep precheck out of scenario stats

  console.log(`${colors.bright}Export load test${colors.reset} → ${cfg.url} | ${cfg.durationSeconds}s @ ${cfg.concurrency} VUs`);

  let stopped = false;
  const stopSampler = () => stopped;
  const sampler = sampleServerRss(cfg, stopSampler);
  const deadline = Date.now() + cfg.durationSeconds * 1000;

  const worker = async () => {
    while (Date.now() < deadline) {
      const roll = Math.random();
      if (roll < 0.35) {
        await runExportSession(cfg, 'invoices');
      } else if (roll < 0.55) {
        await runExportSession(cfg, 'events');
      } else if (roll < 0.8) {
        await runPagination(cfg);
      } else {
        await runJobLifecycle(cfg);
      }
      await new Promise((r) => setTimeout(r, cfg.gapMs));
    }
  };

  const started = Date.now();
  await Promise.all(Array.from({ length: cfg.concurrency }, () => worker()));
  const elapsedSec = (Date.now() - started) / 1000;
  stopped = true;
  await Promise.race([sampler, new Promise((r) => setTimeout(r, 100))]);

  const violations = printSummary(cfg, elapsedSec);
  process.exitCode = violations.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`${colors.red}Export load test crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}${colors.reset}`);
  process.exit(1);
});
