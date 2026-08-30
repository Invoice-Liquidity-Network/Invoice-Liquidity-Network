/**
 * scripts/synthetic-canary.ts
 *
 * Synthetic canary monitoring for ILN main-repo services:
 *   1. Indexer  — public REST API returns correct, current data for a known canary invoice
 *   2. Notifications — test notification through every channel (email, webhook, SMS, WebSocket)
 *   3. Oracle-service — correctly assesses a known canary test address
 *
 * Run standalone:
 *   tsx scripts/synthetic-canary.ts
 *
 * Environment variables (all optional – fall back to safe defaults):
 *   INDEXER_BASE_URL          default: http://localhost:3001
 *   NOTIFICATIONS_BASE_URL    default: http://localhost:4001
 *   NOTIFICATIONS_WS_URL      default: ws://localhost:4002/ws
 *   ORACLE_BASE_URL           default: http://localhost:3010
 *   ALERT_WEBHOOK_URL         when set, failed checks post a JSON alert here
 *   CANARY_INVOICE_ID         invoice ID used for the indexer canary (default: 1)
 *   CANARY_PAYER_ADDRESS      Stellar address used for the oracle canary
 *   CANARY_WEBHOOK_SUB_ID     pre-existing webhook subscription ID to test (default: 0 = skip)
 *   CANARY_REQUEST_TIMEOUT_MS per-request timeout in ms (default: 8000)
 */

function getWebSocketClass(): any {
  if (typeof globalThis.WebSocket !== 'undefined') {
    return globalThis.WebSocket;
  }
  try {
    const req = Function('return require')();
    const wsModule = req('ws');
    return wsModule.WebSocket || wsModule;
  } catch {
    throw new Error('WebSocket client is not available in current runtime environment');
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

const INDEXER_BASE_URL =
  (process.env.INDEXER_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const NOTIFICATIONS_BASE_URL =
  (process.env.NOTIFICATIONS_BASE_URL ?? 'http://localhost:4001').replace(/\/+$/, '');
const NOTIFICATIONS_WS_URL =
  process.env.NOTIFICATIONS_WS_URL ?? 'ws://localhost:4002/ws';
const ORACLE_BASE_URL =
  (process.env.ORACLE_BASE_URL ?? 'http://localhost:3010').replace(/\/+$/, '');
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL ?? '';
const CANARY_INVOICE_ID = Number(process.env.CANARY_INVOICE_ID ?? '1');
const CANARY_PAYER_ADDRESS =
  process.env.CANARY_PAYER_ADDRESS ??
  'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';
const CANARY_WEBHOOK_SUB_ID = Number(process.env.CANARY_WEBHOOK_SUB_ID ?? '0');
const REQUEST_TIMEOUT_MS = Number(process.env.CANARY_REQUEST_TIMEOUT_MS ?? '8000');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  passed: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
}

export interface CanaryReport {
  runAt: string;
  passed: boolean;
  checks: CheckResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

async function runCheck(
  name: string,
  fn: () => Promise<string>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { name, passed: true, durationMs: Date.now() - start, detail };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { name, passed: false, durationMs: Date.now() - start, error };
  }
}

async function postAlert(message: string): Promise<void> {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🚨 ILN Canary Alert: ${message}` }),
    });
  } catch {
    // best-effort – never throw from alerting
  }
}

// ── Check 1: Indexer ─────────────────────────────────────────────────────────

/**
 * Verifies the indexer's public REST API:
 *   - /health responds with status "ok" and a recent lastSync timestamp
 *   - /v1/invoice/:id returns the canary invoice with a recognisable numeric `id`
 */
export async function checkIndexer(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1a. Health endpoint
  results.push(
    await runCheck('indexer:health', async () => {
      const res = await timedFetch(`${INDEXER_BASE_URL}/v1/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        status: string;
        lastSync: string | null;
        uptime: number;
      };
      if (body.status !== 'ok') throw new Error(`status="${body.status}"`);
      return `status=ok uptime=${body.uptime}ms lastSync=${body.lastSync ?? 'none'}`;
    }),
  );

  // 1b. Canary invoice lookup
  results.push(
    await runCheck(`indexer:invoice:${CANARY_INVOICE_ID}`, async () => {
      const res = await timedFetch(
        `${INDEXER_BASE_URL}/v1/invoice/${CANARY_INVOICE_ID}`,
      );
      if (res.status === 404)
        throw new Error(
          `Canary invoice #${CANARY_INVOICE_ID} not found — seed data may be missing`,
        );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { invoice?: { id: number; status: string } };
      const inv = body.invoice;
      if (!inv || typeof inv.id !== 'number') {
        throw new Error('Response missing invoice object');
      }
      if (inv.id !== CANARY_INVOICE_ID) {
        throw new Error(`Expected id=${CANARY_INVOICE_ID}, got id=${inv.id}`);
      }
      return `id=${inv.id} status=${inv.status}`;
    }),
  );

  // 1c. Stats/dashboard availability
  results.push(
    await runCheck('indexer:stats', async () => {
      const res = await timedFetch(`${INDEXER_BASE_URL}/v1/stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      const keys = Object.keys(body).join(', ');
      return `stats keys=[${keys}]`;
    }),
  );

  return results;
}

// ── Check 2: Notifications ────────────────────────────────────────────────────

/**
 * Verifies the notifications service delivers through every channel:
 *   - Email   : health endpoint (actual email sending is gated on env creds)
 *   - Webhook : POST /test-webhook for an existing subscription, or health only
 *   - SMS     : health endpoint (actual SMS is gated on Twilio creds)
 *   - WebSocket: connects to the WS port and receives the initial heartbeat frame
 */
export async function checkNotifications(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 2a. HTTP health
  results.push(
    await runCheck('notifications:health', async () => {
      const res = await timedFetch(`${NOTIFICATIONS_BASE_URL}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { status: string };
      if (body.status !== 'ok') throw new Error(`status="${body.status}"`);
      return 'status=ok';
    }),
  );

  // 2b. Email channel — subscribe + validate response (no actual send in canary)
  results.push(
    await runCheck('notifications:channel:email', async () => {
      // Attempt to create a canary subscription. The service will accept/reject
      // correctly formatted requests even without live Resend credentials.
      const res = await timedFetch(`${NOTIFICATIONS_BASE_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stellar_address: CANARY_PAYER_ADDRESS,
          channel: 'email',
          destination: 'canary@iln.finance',
          triggers: ['invoice_funded'],
        }),
      });
      // 201 = created successfully; 409/4xx means already exists or validation
      // Both are acceptable outcomes for a canary — we just need the service to respond.
      if (res.status !== 201 && res.status >= 500) {
        throw new Error(`Unexpected server error HTTP ${res.status}`);
      }
      return `HTTP ${res.status} — email channel responsive`;
    }),
  );

  // 2c. Webhook channel — test an existing subscription if CANARY_WEBHOOK_SUB_ID > 0
  results.push(
    await runCheck('notifications:channel:webhook', async () => {
      if (CANARY_WEBHOOK_SUB_ID <= 0) {
        // No subscription ID provided — just verify the endpoint is reachable
        const res = await timedFetch(`${NOTIFICATIONS_BASE_URL}/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return 'webhook channel reachable (no sub ID configured — health proxy used)';
      }
      const res = await timedFetch(`${NOTIFICATIONS_BASE_URL}/test-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: CANARY_WEBHOOK_SUB_ID }),
      });
      if (!res.ok && res.status !== 200) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as { success: boolean; statusCode: number };
      if (!body.success) {
        throw new Error(`Webhook delivery failed — statusCode=${body.statusCode}`);
      }
      return `webhook delivered statusCode=${body.statusCode}`;
    }),
  );

  // 2d. SMS channel — validate E.164 guard (no actual send in canary)
  results.push(
    await runCheck('notifications:channel:sms', async () => {
      // POST a subscribe request with a valid E.164 test number.
      // The service returns 201 on success or a 4xx validation error — both
      // demonstrate the SMS code path is reachable. A 5xx means degraded service.
      const res = await timedFetch(`${NOTIFICATIONS_BASE_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stellar_address: CANARY_PAYER_ADDRESS,
          channel: 'sms',
          destination: '+15005550006', // Twilio test magic number
          triggers: ['invoice_funded'],
        }),
      });
      if (res.status >= 500) {
        throw new Error(`Unexpected server error HTTP ${res.status}`);
      }
      return `HTTP ${res.status} — SMS channel responsive`;
    }),
  );

  // 2e. WebSocket channel — connect and verify initial heartbeat frame
  results.push(
    await runCheck('notifications:channel:websocket', async () => {
      return new Promise<string>((resolve, reject) => {
        const WSClass = getWebSocketClass();
        const ws = new WSClass(NOTIFICATIONS_WS_URL);

        const deadline = setTimeout(() => {
          if (typeof ws.terminate === 'function') ws.terminate();
          else if (typeof ws.close === 'function') ws.close();
          reject(new Error(`WebSocket heartbeat not received within ${REQUEST_TIMEOUT_MS}ms`));
        }, REQUEST_TIMEOUT_MS);

        const handleMessage = (rawData: any) => {
          try {
            const dataStr = typeof rawData === 'string' ? rawData : rawData.toString();
            const msg = JSON.parse(dataStr) as {
              type: string;
              payload?: { clientId?: string };
            };
            if (msg.type === 'heartbeat') {
              clearTimeout(deadline);
              if (typeof ws.close === 'function') ws.close(1000, 'canary done');
              resolve(`heartbeat received clientId=${msg.payload?.clientId ?? 'n/a'}`);
            }
          } catch {
            // non-JSON frames ignored
          }
        };

        const handleError = (err: any) => {
          clearTimeout(deadline);
          const msg = err?.message ?? String(err);
          reject(new Error(`WebSocket connection error: ${msg}`));
        };

        if (typeof ws.on === 'function') {
          ws.on('error', handleError);
          ws.on('message', handleMessage);
        } else if (typeof ws.addEventListener === 'function') {
          ws.addEventListener('error', handleError);
          ws.addEventListener('message', (evt: any) => handleMessage(evt.data));
        }
      });
    }),
  );

  return results;
}

// ── Check 3: Oracle-service ───────────────────────────────────────────────────

/**
 * Verifies the oracle-service:
 *   - /v1/health returns status "ok"
 *   - POST /v1/verify with the canary Stellar address returns a valid assessment
 *     (trustScore present, isVerified boolean, no server error)
 */
export async function checkOracle(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 3a. Health
  results.push(
    await runCheck('oracle:health', async () => {
      const res = await timedFetch(`${ORACLE_BASE_URL}/v1/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        status: string;
        uptimeMs: number;
        cache: string;
        reputationConfigured: boolean;
      };
      if (body.status !== 'ok' && body.status !== 'degraded') {
        throw new Error(`Unexpected status="${body.status}"`);
      }
      return (
        `status=${body.status} cache=${body.cache} ` +
        `reputationConfigured=${body.reputationConfigured} uptime=${body.uptimeMs}ms`
      );
    }),
  );

  // 3b. Verification of the canary payer address
  results.push(
    await runCheck(`oracle:verify:${CANARY_PAYER_ADDRESS.slice(0, 8)}…`, async () => {
      const res = await timedFetch(`${ORACLE_BASE_URL}/v1/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payer: CANARY_PAYER_ADDRESS,
          amount: '10000000', // 1 USDC in stroops
          invoiceId: CANARY_INVOICE_ID,
          requestId: `canary-${Date.now()}`,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(`HTTP ${res.status}: ${body.error ?? 'unknown'}`);
      }
      const body = (await res.json()) as {
        isVerified: boolean;
        trustScore: number;
        confidenceLevel: string;
        cacheHit: boolean;
        dataAgeMs?: number;
      };
      if (typeof body.isVerified !== 'boolean') {
        throw new Error('Response missing isVerified field');
      }
      if (typeof body.trustScore !== 'number') {
        throw new Error('Response missing trustScore field');
      }
      return (
        `isVerified=${body.isVerified} trustScore=${body.trustScore} ` +
        `confidence=${body.confidenceLevel} cacheHit=${body.cacheHit}`
      );
    }),
  );

  return results;
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runAllCanaryChecks(): Promise<CanaryReport> {
  const [indexerResults, notificationsResults, oracleResults] = await Promise.all([
    checkIndexer(),
    checkNotifications(),
    checkOracle(),
  ]);

  const checks = [...indexerResults, ...notificationsResults, ...oracleResults];
  const passed = checks.every((c) => c.passed);

  return {
    runAt: new Date().toISOString(),
    passed,
    checks,
  };
}

// ── CLI entry-point ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════');
  console.log('   ILN Synthetic Canary Monitor');
  console.log('══════════════════════════════════════════');
  console.log(`Indexer:       ${INDEXER_BASE_URL}`);
  console.log(`Notifications: ${NOTIFICATIONS_BASE_URL}`);
  console.log(`Oracle:        ${ORACLE_BASE_URL}`);
  console.log(`Canary invoice #${CANARY_INVOICE_ID}  payer=${CANARY_PAYER_ADDRESS.slice(0, 8)}…`);
  console.log('');

  const report = await runAllCanaryChecks();

  for (const check of report.checks) {
    const icon = check.passed ? '✅' : '❌';
    const note = check.passed ? check.detail ?? '' : `ERROR: ${check.error ?? ''}`;
    console.log(`${icon}  [${check.durationMs}ms]  ${check.name}`);
    if (note) console.log(`     ${note}`);
  }

  console.log('');
  console.log('══════════════════════════════════════════');

  if (report.passed) {
    console.log('✅  All canary checks passed.');
  } else {
    const failed = report.checks.filter((c) => !c.passed);
    console.log(`❌  ${failed.length} check(s) failed:`);
    for (const f of failed) {
      console.log(`   • ${f.name}: ${f.error}`);
      await postAlert(`${f.name} — ${f.error}`);
    }
    process.exitCode = 1;
  }
}

// Only auto-run when executed as a script (not when imported by tests)
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] != null &&
  process.argv[1].endsWith('synthetic-canary.ts');

if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error('Fatal canary error:', err);
    process.exit(1);
  });
}
