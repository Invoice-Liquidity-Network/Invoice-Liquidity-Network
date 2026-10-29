/**
 * Real child process for `tests/crash-recovery.test.ts` (issue #1059).
 *
 * This is a separate OS process, so the only thing it shares with the test is
 * the SQLite file on disk. When it is SIGKILLed mid-dispatch there is nothing
 * left in memory to lean on: whatever the test then reads back from the file is
 * proof of durability rather than proof of interpreter state.
 *
 * Modes
 *   --mode crash   Seed an overdue invoice plus a matching webhook
 *                  subscription, then run the production pipeline
 *                  (`processScheduledNotifications()`, i.e. what the poller
 *                  runs). The provider boundary — the global `fetch` that
 *                  `sendWebhook` performs — records that the request really has
 *                  arrived and then blocks forever, because no response ever
 *                  comes back. The parent test polls for that record and
 *                  SIGKILLs this process group, so the death happens strictly
 *                  after the durable enqueue and strictly before any delivery is
 *                  confirmed: the worst case for a service without a journal.
 *   --mode flush   Do not seed anything; run the recovery path a restarted
 *                  service runs (`flushPendingNotifications()`) against a
 *                  provider that accepts the webhook.
 *
 * Deliberate constraint: only the provider is stubbed. The dispatch journal is
 * the real `src/db.ts` code writing to a real file — `enqueueDispatchAttempt`,
 * `getPendingDispatchAttempts` and `markDispatchAttemptDelivered` cannot be
 * faked from here, so emptying their bodies makes this child produce no row (or
 * a row that never leaves `pending`) and the parent test fails.
 *
 * Run directly for debugging:
 *   pnpm exec tsx tests/fixtures/dispatch-crash-child.ts \
 *     --mode crash --db /tmp/x.sqlite --provider-log /tmp/x.log
 */

import { appendFileSync } from 'fs';

type Mode = 'crash' | 'flush';

/**
 * Fixture facts, deliberately duplicated in the parent test rather than shared:
 * the assertions there must not depend on this file's values being in sync with
 * production behaviour. Importing this module runs the child, so nothing may.
 */
const FIXTURE = {
  invoiceId: 9311,
  freelancer: 'GAFREELANCER',
  payer: 'GAPAYER',
  trigger: 'invoice_overdue' as const,
  channel: 'webhook' as const,
  /** Public but never actually connected to: the provider call is stubbed. */
  destination: 'http://8.8.8.8/hook',
};

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    flags[key] = value;
    i++;
  }
  return flags;
}

const flags = parseFlags(process.argv.slice(2));
const mode = flags.mode as Mode | undefined;
const dbPath = flags.db;
const providerLogPath = flags['provider-log'];

if (!dbPath || !providerLogPath || (mode !== 'crash' && mode !== 'flush')) {
  console.error(
    '[child] usage: dispatch-crash-child.ts --mode crash|flush --db <sqlite path> --provider-log <file>'
  );
  process.exit(2);
}

// `src/config.ts` validates the environment the moment it is imported, so every
// variable has to exist before the dynamic imports below. The database path is
// forced, not defaulted: this process must only ever touch the file it was
// handed.
process.env.NOTIFICATIONS_DB_PATH = dbPath;
process.env.NOTIFICATIONS_RPC_URL = 'http://localhost:8000';
process.env.NOTIFICATIONS_CONTRACT_ID = 'GTESTCONTRACT';
process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.RESEND_API_KEY = 'test-api-key';

/** Append one physical provider contact so the parent can count sends exactly. */
function record(event: 'in-flight' | 'delivered' | 'survived', detail: string): void {
  appendFileSync(providerLogPath, `${event} ${detail}\n`);
}

/**
 * The provider receives the webhook and never answers: this process parks with
 * the request in flight, holding the event loop open, until the test SIGKILLs
 * the group. Dying from the outside is the point — nothing here chooses when it
 * stops, and nothing it had in memory survives it.
 */
function stubProviderThatHoldsTheRequest(): void {
  (globalThis as any).fetch = async (input: unknown) => {
    record('in-flight', String(input));
    setInterval(() => {}, 500); // ref'd: stay alive so the kill is the test's, not ours
    await new Promise<void>(() => {}); // no response ever arrives
    throw new Error('unreachable: the request never completes');
  };
}

/** A provider that accepts the webhook, for the resumed process. */
function stubProviderThatAccepts(): void {
  (globalThis as any).fetch = async (input: unknown) => {
    record('delivered', String(input));
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/**
 * Leak guard for a crash child the test never got around to killing. Unref'd so
 * it never keeps a healthy process — such as the flush mode — alive.
 */
const watchdog = setTimeout(() => {
  console.error('[child] watchdog: exiting instead of lingering as a leaked crash process');
  process.exit(4);
}, 45_000);
if (typeof (watchdog as any).unref === 'function') {
  (watchdog as any).unref();
}

/** Idempotent: a replayed crash run must not create a second subscription. */
function seedOverdueInvoice(db: any): void {
  const nowSeconds = Math.floor(Date.now() / 1000);

  db.upsertInvoice({
    id: FIXTURE.invoiceId,
    freelancer: FIXTURE.freelancer,
    payer: FIXTURE.payer,
    amount: '5000000',
    // Past due, so `notifyOverdue()` dispatches `invoice_overdue` to the payer.
    due_date: nowSeconds - 3600,
    discount_rate: 100,
    status: 'Funded',
    funder: 'GLP',
    funded_at: nowSeconds - 86400,
  });

  const alreadyHooked = db
    .getSubscriptionsByAddress(FIXTURE.payer)
    .some(
      (subscription: any) =>
        subscription.channel === FIXTURE.channel && subscription.destination === FIXTURE.destination
    );
  if (!alreadyHooked) {
    db.createSubscription({
      stellar_address: FIXTURE.payer,
      channel: FIXTURE.channel,
      destination: FIXTURE.destination,
      triggers: [FIXTURE.trigger],
      webhook_secret: 'test-webhook-secret',
    });
  }
}

async function main(): Promise<void> {
  const dbModule = await import('../../src/db');
  const handle = dbModule.createDb(dbPath);
  dbModule.setDb(handle);

  try {
    if (mode === 'crash') {
      seedOverdueInvoice(dbModule);
      stubProviderThatHoldsTheRequest();
      const processor = await import('../../src/processor');
      await processor.processScheduledNotifications();
      // Reached only if the pipeline never contacted the provider, which means
      // the notification was dropped somewhere before dispatch.
      record('survived', 'processScheduledNotifications returned without a provider call');
      return;
    }

    const processor = await import('../../src/processor');
    stubProviderThatAccepts();
    await processor.flushPendingNotifications();
  } finally {
    handle.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('[child] failed:', error);
    process.exit(1);
  }
);
