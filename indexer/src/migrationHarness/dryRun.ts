import { Worker } from 'worker_threads';
import { createRequire } from 'module';
import Database from 'better-sqlite3';
import { createDb } from '../db';
import { seedSnapshot } from './snapshot';
import type { HarnessMigration, MigrationMeasurement, SnapshotScale } from './types';

/** Poll interval for the concurrent reader loop (ms). */
const READER_POLL_INTERVAL_MS = 2;
/** Upper bound for the reader's busy_timeout so a lock wait cannot hang forever. */
const READER_BUSY_TIMEOUT_MS = 30_000;

/**
 * better-sqlite3 is a native CJS module. Both vitest's SSR runner and tsx
 * expose `require` for files in packages without "type": "module"; the
 * createRequire fallback keeps the harness usable if it is ever loaded by a
 * pure-ESM loader.
 */
function resolveDriverPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require.resolve('better-sqlite3');
  } catch {
    return createRequire(`${process.cwd()}/noop.cjs`).resolve('better-sqlite3');
  }
}

/**
 * Plain-JS worker body evaluated with `eval: true`. It runs in its own thread
 * with its own better-sqlite3 connection and polls a representative read on a
 * loop, reporting the worst latency it observed — the lock-duration proxy for
 * whatever exclusive lock the migration holds on the main thread. (SQLite WAL
 * lets ordinary readers skip writers, but DDL needs an exclusive lock, which
 * is exactly what this measures.)
 */
const READER_WORKER_SOURCE = `
const { parentPort, workerData, receiveMessageOnPort } = require('node:worker_threads');
const Driver = require(workerData.driverPath);
const db = new Driver(workerData.dbPath, { readonly: true });
db.pragma('busy_timeout = ' + workerData.busyTimeoutMs);
const stmt = db.prepare('SELECT COUNT(*) AS c FROM events WHERE invoice_id = ?');
const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
let reads = 0, busyReads = 0, maxLatencyMs = 0;
stmt.get(1); // warm the connection so startup cost is not counted as lock time
parentPort.postMessage('ready');
// This loop blocks the worker's event loop, so the stop signal must be
// polled synchronously with receiveMessageOnPort, not via a message event.
let stop = false;
while (!stop) {
  const t0 = performance.now();
  try {
    stmt.get(1 + (reads % 1000));
    reads++;
    const latency = performance.now() - t0;
    if (latency > maxLatencyMs) maxLatencyMs = latency;
  } catch (err) {
    const code = String((err && err.code) || '');
    if (code.includes('SQLITE_BUSY')) busyReads++;
    else throw err;
  }
  Atomics.wait(sleepBuf, 0, 0, workerData.pollIntervalMs);
  const msg = receiveMessageOnPort(parentPort);
  if (msg && msg.message === 'stop') stop = true;
}
parentPort.postMessage({ stats: true, reads, busyReads, maxLatencyMs });
`;

interface ReaderStats {
  reads: number;
  busyReads: number;
  maxLatencyMs: number;
}

/**
 * Run `migrationWork()` on the main thread while a concurrent reader polls
 * from a worker thread, and return both the measured runtime and the reader's
 * worst observed latency.
 */
function measureWithConcurrentReader(
  dbPath: string,
  migrationWork: () => number
): Promise<{ runMs: number; stats: ReaderStats }> {
  const worker = new Worker(READER_WORKER_SOURCE, {
    eval: true,
    workerData: {
      dbPath,
      driverPath: resolveDriverPath(),
      pollIntervalMs: READER_POLL_INTERVAL_MS,
      busyTimeoutMs: READER_BUSY_TIMEOUT_MS,
    },
  });

  return new Promise((resolve, reject) => {
    let stats: ReaderStats = { reads: 0, busyReads: 0, maxLatencyMs: 0 };
    let runMs = 0;
    let rejected = false;

    worker.on('message', (msg: unknown) => {
      if (msg === 'ready') {
        try {
          runMs = migrationWork();
          worker.postMessage('stop');
        } catch (err) {
          rejected = true;
          worker.terminate();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      } else if (typeof msg === 'object' && msg !== null && (msg as { stats?: boolean }).stats) {
        stats = msg as ReaderStats;
        // Stats received — shut the reader down; resolution happens on exit.
        worker.terminate();
      }
    });
    worker.on('error', (err) => {
      if (!rejected) {
        rejected = true;
        reject(err);
      }
    });
    worker.on('exit', () => {
      if (!rejected) resolve({ runMs, stats });
    });
  });
}

/**
 * Apply `migration.up()` against a production-shaped snapshot inside a
 * measured exclusive transaction, with a concurrent reader on a second
 * connection reporting how long it was kept out.
 *
 * `dbPath` must be a file path — in-memory databases cannot be shared across
 * connections. The snapshot is seeded from scratch on each run.
 */
export async function dryRunMigration(
  migration: HarnessMigration,
  dbPath: string,
  scale: SnapshotScale
): Promise<MigrationMeasurement> {
  const seedDb = createDb(dbPath);
  seedSnapshot(seedDb, scale);
  seedDb.close();

  const { runMs, stats } = await measureWithConcurrentReader(dbPath, () => {
    const db = new Database(dbPath);
    try {
      const start = performance.now();
      db.transaction(() => migration.up(db))();
      return performance.now() - start;
    } finally {
      db.close();
    }
  });

  return {
    id: migration.id,
    runMs,
    lockMs: stats.maxLatencyMs,
    reads: stats.reads,
    busyReads: stats.busyReads,
  };
}
