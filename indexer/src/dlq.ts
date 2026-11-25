/**
 * Dead-letter queue for events the indexer could not apply (issue #1441).
 *
 * Audit finding: before this change `DeadLetterQueue.enqueue` was an empty
 * stub with no callers, so a failed event was neither kept, counted, nor
 * retryable here. Failures were only visible as a thrown error in the
 * poller/processor (the event is not committed and is replayed on the next
 * poll, see tests/reorg-idempotency.test.ts).
 *
 * Behavior now:
 *  - `enqueue` keeps the event with its error, attempt count and timestamps.
 *    Enqueueing the same key again records another failed attempt instead of
 *    adding a duplicate entry.
 *  - `retryDue(handler)` re-runs only entries whose backoff has elapsed.
 *    A success removes the entry. A failure increments `attempts` and doubles
 *    the backoff. Once `attempts` reaches `maxAttempts` the entry is marked
 *    `exhausted`: it stops being retried but stays listed, so it remains
 *    observable until an operator calls `requeue` (resume) or `discard`.
 *  - Errors flagged `permanent` (malformed events) are exhausted at once.
 *
 * It is in-memory: entries are lost on restart. That is acceptable only
 * because un-applied events are not committed and are re-fetched from the
 * cursor on restart; persisting the queue is a maintainer decision.
 */

import { dlqEnqueuedTotal, dlqExhaustedTotal } from './metrics';

export type DeadLetterState = 'pending' | 'exhausted';

export interface DeadLetterEntry<T = unknown> {
  key: string;
  event: T;
  state: DeadLetterState;
  /** Failed attempts so far, including the one that enqueued it. */
  attempts: number;
  lastError: string;
  firstFailedAt: number;
  lastFailedAt: number;
  /** Earliest time (ms) a retry may run; undefined once exhausted. */
  nextRetryAt?: number;
}

export interface DeadLetterOptions {
  /** Attempts (including the first failure) before an entry is exhausted. Default 5. */
  maxAttempts?: number;
  /** Backoff after the first failure in ms; doubles per attempt. Default 1000. */
  baseDelayMs?: number;
  /** Upper bound for the backoff in ms. Default 5 minutes. */
  maxDelayMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface EnqueueOptions {
  /** Stable identity (e.g. the event id); defaults to `event.id` / `event.event_id`. */
  key?: string;
  /** The error that caused the failure. */
  error?: unknown;
  /** True for failures that a retry cannot fix (malformed payloads). */
  permanent?: boolean;
}

export interface RetryReport {
  attempted: number;
  succeeded: number;
  failed: number;
  exhausted: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error === undefined) return 'unknown error';
  return String(error);
}

let anonymousKeys = 0;

function keyOf(event: unknown, explicit?: string): string {
  if (explicit) return explicit;
  if (event && typeof event === 'object') {
    const record = event as Record<string, unknown>;
    if (typeof record.event_id === 'string') return record.event_id;
    if (typeof record.id === 'string' || typeof record.id === 'number') return String(record.id);
  }
  anonymousKeys += 1;
  return `anonymous-${anonymousKeys}`;
}

export class DeadLetterQueue<T = any> {
  private readonly entries = new Map<string, DeadLetterEntry<T>>();
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;

  constructor(options: DeadLetterOptions = {}) {
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 5));
    this.baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000);
    this.maxDelayMs = Math.max(this.baseDelayMs, options.maxDelayMs ?? 300_000);
    this.now = options.now ?? Date.now;
  }

  /** Record a failed event. Returns the stored entry. */
  enqueue(event: T, options: EnqueueOptions = {}): DeadLetterEntry<T> {
    const key = keyOf(event, options.key);
    const now = this.now();
    const existing = this.entries.get(key);
    const entry: DeadLetterEntry<T> = existing ?? {
      key,
      event,
      state: 'pending',
      attempts: 0,
      lastError: '',
      firstFailedAt: now,
      lastFailedAt: now,
    };
    entry.event = event;
    this.recordFailure(entry, options.error, options.permanent === true, now);
    this.entries.set(key, entry);
    return { ...entry };
  }

  /**
   * Retry every pending entry whose backoff has elapsed. The handler should
   * throw on failure. Entries are retried one at a time in enqueue order.
   */
  async retryDue(handler: (event: T, entry: DeadLetterEntry<T>) => unknown): Promise<RetryReport> {
    const report: RetryReport = { attempted: 0, succeeded: 0, failed: 0, exhausted: 0 };
    const due = [...this.entries.values()].filter(
      (e) => e.state === 'pending' && (e.nextRetryAt ?? 0) <= this.now()
    );
    for (const entry of due) {
      report.attempted += 1;
      try {
        await handler(entry.event, { ...entry });
        this.entries.delete(entry.key);
        report.succeeded += 1;
      } catch (error) {
        this.recordFailure(entry, error, false, this.now());
        report.failed += 1;
        if (entry.state === 'exhausted') report.exhausted += 1;
      }
    }
    return report;
  }

  /** Put an exhausted (or pending) entry back in line with a fresh attempt budget. */
  requeue(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    entry.state = 'pending';
    entry.attempts = 0;
    entry.nextRetryAt = this.now();
    return true;
  }

  /** Drop an entry for good (operator decision). */
  discard(key: string): boolean {
    return this.entries.delete(key);
  }

  get(key: string): DeadLetterEntry<T> | undefined {
    const entry = this.entries.get(key);
    return entry ? { ...entry } : undefined;
  }

  list(state?: DeadLetterState): DeadLetterEntry<T>[] {
    return [...this.entries.values()]
      .filter((e) => state === undefined || e.state === state)
      .map((e) => ({ ...e }));
  }

  get size(): number {
    return this.entries.size;
  }

  stats(): { pending: number; exhausted: number } {
    let pending = 0;
    let exhausted = 0;
    for (const entry of this.entries.values()) {
      if (entry.state === 'pending') pending += 1;
      else exhausted += 1;
    }
    return { pending, exhausted };
  }

  private recordFailure(
    entry: DeadLetterEntry<T>,
    error: unknown,
    permanent: boolean,
    now: number
  ): void {
    entry.attempts += 1;
    entry.lastError = errorMessage(error);
    entry.lastFailedAt = now;
    try {
      dlqEnqueuedTotal.inc();
    } catch {
      /* metrics failure is non-fatal */
    }
    if (permanent || entry.attempts >= this.maxAttempts) {
      if (entry.state !== 'exhausted') {
        try {
          dlqExhaustedTotal.inc();
        } catch {
          /* metrics failure is non-fatal */
        }
      }
      entry.state = 'exhausted';
      delete entry.nextRetryAt;
      return;
    }
    entry.state = 'pending';
    const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (entry.attempts - 1));
    entry.nextRetryAt = now + delay;
  }
}
