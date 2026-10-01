/**
 * CLI entry point: `pnpm chaos:run` (or `tsx tests/chaos/run.ts`).
 * Requires a running stack with Toxiproxy (see docs/chaos-engineering.md).
 *
 *   CHAOS_TOXIPROXY_URL   default http://localhost:8474
 *   CHAOS_ORACLE_URL      default http://localhost:3010
 *   CHAOS_INDEXER_URL     default http://localhost:3001
 *   CHAOS_NOTIFICATIONS_URL default http://localhost:4001
 *   CHAOS_SCENARIOS       comma-separated subset of scenario names
 *   CHAOS_TIME_SCALE      multiply every duration (0.2 for a quick smoke run)
 *   CHAOS_REPORT_DIR      where chaos-report.json / chaos-report.md are written (default .chaos)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ENDPOINTS } from './probes';
import { renderMarkdown } from './report';
import { runSuite } from './runner';
import { SCENARIOS } from './scenarios';
import { ToxiproxyClient } from './toxiproxy-client';

async function main(): Promise<void> {
  const toxiproxy = new ToxiproxyClient(process.env.CHAOS_TOXIPROXY_URL ?? 'http://localhost:8474');
  const version = await toxiproxy.version();
  const filter = process.env.CHAOS_SCENARIOS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const scenarios = filter?.length ? SCENARIOS.filter((s) => filter.includes(s.name)) : SCENARIOS;
  if (scenarios.length === 0)
    throw new Error(`no scenarios match CHAOS_SCENARIOS=${process.env.CHAOS_SCENARIOS}`);
  console.log(
    `toxiproxy ${version}; running ${scenarios.length} scenario(s): ${scenarios
      .map((s) => s.name)
      .join(', ')}`
  );

  const results = await runSuite(scenarios, {
    toxiproxy,
    endpoints: DEFAULT_ENDPOINTS,
    timeScale: Number(process.env.CHAOS_TIME_SCALE ?? 1),
    log: (line) => console.log(line),
  });

  const dir = process.env.CHAOS_REPORT_DIR ?? '.chaos';
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'chaos-report.json'), JSON.stringify(results, null, 2));
  const markdown = renderMarkdown(results);
  writeFileSync(join(dir, 'chaos-report.md'), markdown);
  console.log(markdown);
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
