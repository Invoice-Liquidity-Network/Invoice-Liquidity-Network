/**
 * Issue #1059 — at-least-once delivery, proven the only way it can be proven: a
 * real second process is SIGKILLed while a dispatch is in flight, and a third
 * one resumes from the SQLite file the corpse left behind.
 *
 * Why a child process: closing and reopening a database inside one interpreter
 * proves nothing about durability, because the "crashed" process still owns
 * every byte of memory, every handle and every mock. Here the dying process
 * shares only the file with the test, so what the test reads back is the durable
 * record. The pipeline under test is the real one
 * (`processScheduledNotifications` -> `dispatchNotifications` ->
 * `enqueueDispatchAttempt` -> `deliverNotification` -> `sendWebhook`), the
 * database is a real file, and only the provider boundary is stubbed — inside
 * the child, where stubbing it cannot hide a queue bug.
 *
 * The kill is not timed by a sleep: the child appends to the provider log at the
 * instant the webhook request is handed over, this test polls for that record and
 * only then destroys the process group, so the crash always lands in the same
 * window — after the durable enqueue, before any delivery is confirmed.
 *
 * The assertions are made on the file and on the provider's own log, never on a
 * mock call count: a mocked `deliverNotification` would happily "deliver" a
 * notification that was never journaled. Emptying `enqueueDispatchAttempt` leaves
 * the file with no `dispatch_attempts` row after the kill (step 1 fails) and
 * nothing for the restarted process to resume (step 3 fails); turning
 * `markDispatchAttemptDelivered` into a no-op leaves the row `pending` forever
 * (step 3 fails) so step 4 would send it a second time.
 */

import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { beforeAll, describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..');
const childScript = join(testDir, 'fixtures', 'dispatch-crash-child.ts');

const require = createRequire(import.meta.url);
// The child runs the pipeline through the same TypeScript loader `pnpm dev` uses,
// so what gets killed is the shipped pipeline rather than a compiled copy.
const tsxCli = join(dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');

// Duplicated from the fixture on purpose: these are the expectations, not the
// implementation's own constants.
const INVOICE_ID = 9311;
const PAYER = 'GAPAYER';
const TRIGGER = 'invoice_overdue';
const CHANNEL = 'webhook';
const DESTINATION = 'http://8.8.8.8/hook';

/**
 * The dedup key is invoice + trigger + recipient + channel + destination +
 * event id, serialised as a fixed-order array (see `dispatchDedupKey`), and the
 * row id is its sha256. Recomputed here byte for byte, so a key that silently
 * dropped a field — or drifted to a different order — fails this test instead of
 * quietly degrading the guarantee. Scheduled notifications carry no event id,
 * which the composition encodes as the empty string.
 */
const EXPECTED_DEDUP_KEY = JSON.stringify([INVOICE_ID, TRIGGER, PAYER, CHANNEL, DESTINATION, '']);
const EXPECTED_ATTEMPT_ID = createHash('sha256').update(EXPECTED_DEDUP_KEY).digest('hex');

type ProviderEvent = 'in-flight' | 'delivered' | 'survived';
type Mode = 'crash' | 'flush';

interface AttemptRow {
  id: string;
  dedup_key: string;
  invoice_id: number;
  trigger: string;
  recipient_address: string;
  channel: string;
  destination: string;
  event_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  delivered_at: number | null;
}

interface Journal {
  attempts: AttemptRow[];
  sent: Array<{ invoice_id: number; trigger: string; channel: string; destination: string }>;
  successfulWebhooks: number;
  failedWebhooks: number;
}

interface ChildResult {
  code: number | null;
  signal: string | null;
  /** Set when the child could not be spawned at all. */
  spawnError?: string;
}

type SqliteHandle = InstanceType<typeof Database>;
type ChildHandle = ReturnType<typeof spawn>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the durable state with a bare SQLite handle rather than `createDb`, so
 * the evidence is not produced by the same migration code under review. The
 * child died without checkpointing, so this open is also what replays the WAL.
 */
function readJournal(dbFile: string): Journal {
  const handle: SqliteHandle = new Database(dbFile, { fileMustExist: true });
  try {
    return {
      attempts: handle
        .prepare(
          `SELECT id, dedup_key, invoice_id, trigger, recipient_address, channel, destination,
                  event_id, status, attempts, last_error, delivered_at
             FROM dispatch_attempts ORDER BY created_at ASC, id ASC`
        )
        .all() as AttemptRow[],
      sent: handle
        .prepare(
          `SELECT invoice_id, trigger, channel, destination
             FROM sent_notifications ORDER BY sent_at ASC`
        )
        .all() as Journal['sent'],
      successfulWebhooks: countWebhookLogs(handle, 'success'),
      failedWebhooks: countWebhookLogs(handle, 'failed'),
    };
  } finally {
    handle.close();
  }
}

function countWebhookLogs(handle: SqliteHandle, status: 'success' | 'failed'): number {
  const table = handle
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'webhook_delivery_logs'`
    )
    .get();
  if (!table) return 0;
  const row = handle
    .prepare('SELECT COUNT(*) AS c FROM webhook_delivery_logs WHERE status = ?')
    .get(status) as { c: number };
  return row.c;
}

/** Every physical provider contact, in order, as the provider itself saw it. */
function providerEvents(providerLog: string, event: ProviderEvent): string[] {
  return readFileSync(providerLog, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith(`${event} `));
}

function spawnChild(mode: Mode, paths: { dbFile: string; providerLog: string }): ChildHandle {
  return spawn(
    process.execPath,
    [
      tsxCli,
      childScript,
      '--mode',
      mode,
      '--db',
      paths.dbFile,
      '--provider-log',
      paths.providerLog,
    ],
    {
      cwd: packageRoot,
      // Its own process group, so one SIGKILL takes the loader and the pipeline
      // down together instead of orphaning them.
      detached: true,
      env: { ...process.env, NODE_ENV: 'test' },
    }
  );
}

/**
 * Drain the child's output. Draining matters: an unread pipe can fill up and
 * wedge a child that is only supposed to die from the test's hand.
 */
function captureOutput(child: ChildHandle): () => string {
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      if (output.length < 32_000) output += chunk;
    });
    stream.on('error', () => {});
  }
  return () => output.trim().slice(-3000) || '<none>';
}

function exited(child: ChildHandle): Promise<ChildResult> {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) =>
      resolve({ code: null, signal: null, spawnError: error.message })
    );
  });
}

function killGroup(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone; the outcome is observed through the close event.
    }
  }
}

function describeChild(result: ChildResult, output: string): string {
  const why = result.spawnError
    ? `spawn error: ${result.spawnError}`
    : `code=${result.code} signal=${result.signal}`;
  return `${why} output=${output}`;
}

/**
 * Start the pipeline, wait until the provider's own log proves *this* process
 * handed over a webhook request, then destroy the process group at that
 * instant. The marker is the condition — no guessing how long a cold start
 * takes.
 *
 * The marker is counted relative to what the log already held: the provider log
 * is deliberately preserved across children so the test can count physical
 * sends, so a later crash run reuses the file. Waiting for "any in-flight line"
 * would kill child #2 the instant it started, on child #1's leftover evidence,
 * before it ever dispatched.
 */
async function crashMidDispatch(paths: {
  dbFile: string;
  providerLog: string;
}): Promise<ChildResult> {
  const inFlightBefore = providerEvents(paths.providerLog, 'in-flight').length;
  const child = spawnChild('crash', paths);
  const output = captureOutput(child);
  const done = exited(child);
  let settled = false;
  void done.then(() => {
    settled = true;
  });

  const deadline = Date.now() + 60_000;
  while (providerEvents(paths.providerLog, 'in-flight').length <= inFlightBefore) {
    if (settled) {
      throw new Error(
        'the crash child stopped without contacting the provider, so the mid-dispatch ' +
          `window was never reached: ${describeChild(await done, output())}`
      );
    }
    if (Date.now() > deadline) {
      killGroup(child.pid);
      throw new Error(
        'the crash child never contacted the provider within 60s: ' +
          describeChild(await done, output())
      );
    }
    await delay(20);
  }

  killGroup(child.pid);
  return done;
}

/** Run a child to completion — a restarted service, which must exit cleanly. */
async function runToCompletion(
  mode: Mode,
  paths: { dbFile: string; providerLog: string }
): Promise<ChildResult> {
  const child = spawnChild(mode, paths);
  const output = captureOutput(child);
  const done = exited(child);

  const watchdog = setTimeout(() => killGroup(child.pid), 120_000);
  const result = await done;
  clearTimeout(watchdog);

  if (result.code !== 0) {
    throw new Error(`${mode} child did not finish cleanly: ${describeChild(result, output())}`);
  }
  return result;
}

describe('dispatch crash recovery (issue #1059)', () => {
  beforeAll(() => {
    if (!existsSync(childScript)) {
      throw new Error(`crash child fixture missing at ${childScript}`);
    }
    if (!existsSync(tsxCli)) {
      throw new Error(
        `tsx CLI not found at ${tsxCli}; the crash test spawns the pipeline through it`
      );
    }
  });

  it(
    'survives a process killed mid-dispatch and resumes exactly once',
    { timeout: 300_000 },
    async () => {
      const workspace = mkdtempSync(join(tmpdir(), 'iln-1059-crash-'));
      const paths = {
        dbFile: join(workspace, 'notifications.sqlite'),
        providerLog: join(workspace, 'provider.log'),
      };
      writeFileSync(paths.providerLog, '');

      try {
        // ── 1. the first service process is destroyed while the webhook is in
        //       flight: the intent has to be on disk already ──
        const crashed = await crashMidDispatch(paths);
        expect(crashed.signal).toBe('SIGKILL');
        expect(providerEvents(paths.providerLog, 'in-flight')).toHaveLength(1);
        expect(providerEvents(paths.providerLog, 'delivered')).toHaveLength(0);
        expect(providerEvents(paths.providerLog, 'survived')).toHaveLength(0);

        const afterCrash = readJournal(paths.dbFile);
        expect(afterCrash.attempts).toHaveLength(1);
        expect(afterCrash.attempts[0]).toMatchObject({
          id: EXPECTED_ATTEMPT_ID,
          dedup_key: EXPECTED_DEDUP_KEY,
          invoice_id: INVOICE_ID,
          trigger: TRIGGER,
          recipient_address: PAYER,
          channel: CHANNEL,
          destination: DESTINATION,
          event_id: '',
          status: 'pending',
          attempts: 0,
          last_error: null,
          delivered_at: null,
        });
        // Nothing anywhere claims the notification reached its recipient.
        expect(afterCrash.sent).toHaveLength(0);
        expect(afterCrash.successfulWebhooks).toBe(0);

        // ── 2. a restart that replays the same notification queues no second
        //       copy: at-least-once may retry, but the UNIQUE dedup key forbids
        //       duplicate work ──
        const replayed = await crashMidDispatch(paths);
        expect(replayed.signal).toBe('SIGKILL');
        expect(providerEvents(paths.providerLog, 'in-flight')).toHaveLength(2);

        const afterReplay = readJournal(paths.dbFile);
        expect(afterReplay.attempts).toHaveLength(1);
        expect(afterReplay.attempts[0].id).toBe(EXPECTED_ATTEMPT_ID);
        expect(afterReplay.attempts[0].status).toBe('pending');
        expect(afterReplay.sent).toHaveLength(0);

        // ── 3. a fresh process — the poller's flush, in a brand-new interpreter
        //       — resumes the journal and completes the delivery ──
        const resumed = await runToCompletion('flush', paths);
        expect(resumed.code).toBe(0);
        expect(providerEvents(paths.providerLog, 'delivered')).toHaveLength(1);

        const afterResume = readJournal(paths.dbFile);
        expect(afterResume.attempts).toHaveLength(1);
        expect(afterResume.attempts[0]).toMatchObject({
          id: EXPECTED_ATTEMPT_ID,
          status: 'delivered',
          attempts: 1, // the send is counted; the row is closed out, not deleted
          last_error: null,
        });
        expect(afterResume.attempts[0].delivered_at).toEqual(expect.any(Number));
        expect(afterResume.sent).toHaveLength(1);
        expect(afterResume.sent[0]).toMatchObject({
          invoice_id: INVOICE_ID,
          trigger: TRIGGER,
          channel: CHANNEL,
          destination: DESTINATION,
        });
        expect(afterResume.successfulWebhooks).toBe(1);
        expect(afterResume.failedWebhooks).toBe(0);

        // ── 4. a later poll finds nothing to retry and contacts nobody ──
        await runToCompletion('flush', paths);
        expect(providerEvents(paths.providerLog, 'delivered')).toHaveLength(1);
        expect(providerEvents(paths.providerLog, 'in-flight')).toHaveLength(2);

        // ── 5. and the poller re-running the original pipeline (same invoice,
        //       still overdue) sees the notification as delivered, so it neither
        //       enqueues nor sends a second copy ──
        const reprocessed = await runToCompletion('crash', paths);
        expect(reprocessed.code).toBe(0);
        // Nothing was killed here: dispatch stopped before reaching the provider.
        expect(providerEvents(paths.providerLog, 'survived')).toHaveLength(1);
        expect(providerEvents(paths.providerLog, 'in-flight')).toHaveLength(2);
        expect(providerEvents(paths.providerLog, 'delivered')).toHaveLength(1);

        const final = readJournal(paths.dbFile);
        expect(final.attempts).toHaveLength(1);
        expect(final.attempts[0]).toMatchObject({ status: 'delivered', attempts: 1 });
        expect(final.sent).toHaveLength(1);
        expect(final.successfulWebhooks).toBe(1);
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  );
});
