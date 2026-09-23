import {
  getBackfillCheckpoint,
  saveBackfillCheckpoint,
  clearBackfillCheckpoint,
  countEvents,
  getCursorLedger,
} from './db';
import type { CanonicalHashLookup } from './reorg';

export interface ResumeResult {
  /** Ledger the backfill should resume scanning from. */
  startLedger: number;
  /** True when the checkpoint was integrity-verified against the canonical chain. */
  verified: boolean;
  reason: 'none' | 'verified' | 'hash-mismatch' | 'below-cursor';
}

/**
 * Resume a backfill from the last persisted checkpoint.
 *
 * A checkpoint stores `(ledger, canonical block_hash, event_count)`. On resume we
 * verify the recorded block hash is still canonical at that ledger; that makes a
 * crashed backfill resumable AND protects against resuming from a checkpoint that
 * was itself reorged.
 *
 * - No checkpoint                    → resume from the durable cursor.
 * - Hash verified                    → resume from the checkpoint.
 * - Hash no longer canonical         → restart from genesis (auto-detect).
 * - Checkpoint below the cursor      → the cursor is ahead; trust the cursor.
 */
export async function resumeFromCheckpoint(
  canonicalHashAt: CanonicalHashLookup,
  cursorLedger: number = getCursorLedger()
): Promise<ResumeResult> {
  const cp = getBackfillCheckpoint();
  if (!cp || cp.ledger <= 0) {
    return { startLedger: cursorLedger, verified: false, reason: 'none' };
  }

  if (cp.ledger < cursorLedger) {
    return { startLedger: cursorLedger, verified: false, reason: 'below-cursor' };
  }

  const canonical = await canonicalHashAt(cp.ledger);
  const verified = canonical !== null && canonical === cp.block_hash;

  if (verified) {
    return { startLedger: cp.ledger, verified: true, reason: 'verified' };
  }

  clearBackfillCheckpoint();
  return { startLedger: 0, verified: false, reason: 'hash-mismatch' };
}

export interface CheckpointAdvanceResult {
  updated: boolean;
  ledger?: number;
}

/**
 * Persist a checkpoint if `ledger` is at or past `interval` ledgers since the
 * last saved checkpoint. The block hash is obtained from `canonicalHashAt`.
 */
export async function advanceBackfillCheckpoint(
  ledger: number,
  interval: number,
  canonicalHashAt: CanonicalHashLookup
): Promise<CheckpointAdvanceResult> {
  if (interval <= 0 || ledger <= 0) {
    return { updated: false };
  }

  const last = getBackfillCheckpoint();
  if (last && ledger - last.ledger < interval) {
    return { updated: false };
  }

  const hash = await canonicalHashAt(ledger);
  if (hash === null) {
    return { updated: false };
  }

  saveBackfillCheckpoint(ledger, hash, countEvents());
  return { updated: true, ledger };
}
