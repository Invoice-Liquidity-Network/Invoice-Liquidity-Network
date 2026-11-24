import { getCursorLedger } from './db';
import { confirmationPolicy } from './policy';
import { server } from './rpc';

export interface ReconciliationResult {
  healthy: boolean;
  cursorLedger: number;
  chainTipLedger: number | null;
  driftLedgers: number;
  mismatches: number;
  recommendation: string;
}

/**
 * Reconcile the indexer's persisted cursor against the live chain tip.
 *
 * Failure semantics (#1439):
 * - A tip at or above the cursor within the confirmation depth is healthy.
 * - A tip lagging the cursor beyond the confirmation depth is unhealthy
 *   (the indexer has fallen behind the canonical chain).
 * - A tip *below* the cursor is a chain reorg — always unhealthy, because the
 *   indexer believes it has durably indexed ledgers the chain no longer has.
 * - An unreachable RPC node is unhealthy with a null tip; the job must not
 *   report healthy just because it could not reach the chain.
 */
export async function runReconciliation(): Promise<ReconciliationResult> {
  const cursorLedger = getCursorLedger();
  let chainTipLedger: number;
  try {
    const response = await server.getLatestLedger();
    // The real Stellar SDK returns `{ sequence: number }`; tests may pass a
    // bare number for ergonomics. Support both shapes.
    const raw =
      typeof response === 'number'
        ? response
        : (response as { sequence?: number }).sequence ?? response;
    chainTipLedger = Number(raw);
    if (Number.isNaN(chainTipLedger)) {
      throw new Error('RPC returned invalid ledger sequence');
    }
  } catch (err) {
    return {
      healthy: false,
      cursorLedger,
      chainTipLedger: null,
      driftLedgers: 0,
      mismatches: 0,
      recommendation: `RPC node unreachable: ${err instanceof Error ? err.message : String(err)}. Reconciliation cannot verify chain/indexer alignment.`,
    };
  }

  const driftLedgers = chainTipLedger - cursorLedger;

  // A tip below the persisted cursor is a reorg — always unhealthy.
  if (driftLedgers < 0) {
    return {
      healthy: false,
      cursorLedger,
      chainTipLedger,
      driftLedgers,
      mismatches: 0,
      recommendation: `Chain tip (${chainTipLedger}) is below the persisted cursor (${cursorLedger}) — a chain reorg has occurred. Run pollOnce() to reconcile the cursor before resuming normal operation.`,
    };
  }

  const depth = confirmationPolicy.getDepth();
  const healthy = driftLedgers <= depth;
  const mismatches = 0;

  return {
    healthy,
    cursorLedger,
    chainTipLedger,
    driftLedgers,
    mismatches,
    recommendation: healthy
      ? `Indexer is aligned with the chain (drift: ${driftLedgers} ledgers, within confirmation depth ${depth}).`
      : `Indexer is unhealthy: ${driftLedgers} ledgers behind the chain tip (confirmation depth: ${depth}). Increase poll frequency or investigate RPC latency.`,
  };
}

/**
 * Start a periodic reconciliation scheduler.
 *
 * Errors are logged and swallowed so the scheduler never stops — a failed
 * reconciliation job must not crash the process.
 */
export function startReconciliationScheduler(intervalMs = 3600000): NodeJS.Timeout {
  const run = async () => {
    try {
      const result = await runReconciliation();
      if (!result.healthy) {
        console.warn('[reconciliation] Unhealthy:', result.recommendation);
      }
    } catch (e) {
      console.error('[reconciliation] Job failed:', e);
    }
  };
  // Run immediately, then on a timer.
  run();
  return setInterval(run, intervalMs);
}