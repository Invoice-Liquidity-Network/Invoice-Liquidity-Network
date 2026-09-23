import { getRecordedHashes, rollbackToLedger } from './db';

export interface RecordedHashLike {
  ledger: number;
  hash: string;
}

export interface ReorgDetection {
  /** True when the recorded chain has diverged from the canonical chain. */
  reorged: boolean;
  /** Highest ledger still on the canonical chain; roll back to here. */
  lca: number;
}

/**
 * Returns the canonical hash for a ledger. Injectable so tests can simulate a
 * divergent chain without an RPC; returns null when the hash is unavailable.
 */
export type CanonicalHashLookup = (ledger: number) => Promise<string | null> | string | null;

/**
 * Detect a reorg by comparing recorded block hashes against the canonical chain.
 *
 * Uses the longest-matching-prefix rule: the two chains share every ledger up to
 * the first recorded hash that no longer matches canonical. That ledger is the
 * last common ancestor (LCA); everything above it must be re-derived.
 */
export async function detectReorg(
  recorded: RecordedHashLike[],
  canonicalHashAt: CanonicalHashLookup
): Promise<ReorgDetection> {
  const ordered = [...recorded].sort((a, b) => a.ledger - b.ledger);

  let lca = 0;
  for (const entry of ordered) {
    const canonical = await canonicalHashAt(entry.ledger);
    if (canonical !== null && canonical === entry.hash) {
      lca = entry.ledger;
    } else {
      // First divergence scanning bottom-up: everything at/below the last
      // matching ledger is valid; at/above this ledger needs re-derivation.
      return { reorged: true, lca };
    }
  }
  return { reorged: false, lca: ordered.length > 0 ? ordered[ordered.length - 1].ledger : 0 };
}

/**
 * Detect a reorg against the recorded hash table and, if found, roll back all
 * local state derived from ledgers above the last common ancestor.
 *
 * `rollbackToLedger` deletes the reorged events and ledger hashes, removes the
 * affected invoice rows (they are re-derived on replay) and resets the cursor to
 * the LCA so the next poll resynchronises from the canonical chain.
 */
export async function rollBackFromReorg(
  canonicalHashAt: CanonicalHashLookup,
  fromLedger = 0
): Promise<ReorgDetection> {
  const recorded = getRecordedHashes().filter((r) => r.ledger >= fromLedger);
  if (recorded.length === 0) {
    return { reorged: false, lca: 0 };
  }

  const detection = await detectReorg(recorded, canonicalHashAt);
  if (!detection.reorged) {
    return detection;
  }

  const invoicesRemoved = rollbackToLedger(detection.lca);
  console.warn(
    `[reorg] Chain divergence detected — rolled back ${invoicesRemoved} invoice(s) ` +
      `to ledger ${detection.lca}; replaying from there.`
  );
  return detection;
}
