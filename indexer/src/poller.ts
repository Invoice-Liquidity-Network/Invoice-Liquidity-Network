import type { rpc as StellarRpc } from '@stellar/stellar-sdk';
import { CONFIG } from './config';
import {
  getCursorLedger,
  setCursorLedger,
  recordLedgerHash,
  getRecordedHash,
  latestConfirmedLedger,
} from './db';
import { processEvent } from './processor';
import { server, fetchLedgerHash } from './rpc';
import { rollBackFromReorg } from './reorg';
import { resumeFromCheckpoint, advanceBackfillCheckpoint } from './checkpoint';

const BATCH_SIZE = 200;

const canonicalHashAt = async (ledger: number): Promise<string | null> => fetchLedgerHash(ledger);

/**
 * Run one full polling cycle:
 * - Verify the previously confirmed boundary hash against the canonical chain and
 *   roll back if a reorg was detected.
 * - Determine the start ledger (checkpoint → DB cursor → config/auto-detect).
 * - Page through ALL available contract events in batches of BATCH_SIZE.
 * - Process + persist only events that are `confirmationDepth` behind the tip.
 * - Advance the stored cursor and record the new boundary hash, checkpointing
 *   every `checkpointIntervalLedgers`.
 *
 * The confirmation-depth window means every event we persist is final by policy:
 * state is never surfaced while it could still be reorged.
 */
export async function pollOnce(): Promise<void> {
  const stored = getCursorLedger();

  // ── Reorg detection: verify the previously confirmed boundary ─────────────
  const prevBoundaryHash = getRecordedHash(stored);
  if (stored > 0 && prevBoundaryHash) {
    await rollBackFromReorg(canonicalHashAt, Math.max(0, stored - CONFIG.confirmationDepth));
  }

  // ── Determine start ledger ────────────────────────────────────────────────
  let startLedger: number;
  if (stored === 0) {
    if (CONFIG.startLedger > 0) {
      startLedger = CONFIG.startLedger;
    } else {
      // Resume from a verified backfill checkpoint when present, otherwise
      // auto-detect: start 1 000 ledgers before the current tip (~83 minutes).
      const resumed = await resumeFromCheckpoint(canonicalHashAt, 0);
      if (resumed.reason === 'verified') {
        startLedger = resumed.startLedger;
        console.log(`[poller] Resuming backfill from verified checkpoint at ledger ${startLedger}`);
      } else {
        const latest = await server.getLatestLedger();
        startLedger = Math.max(1, latest.sequence - 1_000);
      }
    }
  } else {
    // Re-scan from the last processed ledger so we never miss an event at the
    // boundary, even if we crashed mid-batch (or were rolled back by a reorg).
    startLedger = stored;
  }

  // ── Page through events ───────────────────────────────────────────────────
  const filters: StellarRpc.Api.EventFilter[] = [
    { type: 'contract', contractIds: [CONFIG.contractId] },
  ];
  let paginationCursor: string | undefined;
  let highestEventLedger = stored;
  let latestKnownLedger = stored;

  do {
    const request: StellarRpc.Api.GetEventsRequest = paginationCursor
      ? { cursor: paginationCursor, filters, limit: BATCH_SIZE }
      : { startLedger, filters, limit: BATCH_SIZE };

    const response = await server.getEvents(request);
    latestKnownLedger = response.latestLedger;

    for (const event of response.events) {
      // Skip events still inside the confirmation window — they are provisional
      // and may be reorged away. Only confirmed state is persisted.
      if (latestKnownLedger - event.ledger < CONFIG.confirmationDepth) {
        continue;
      }
      await processEvent(event);
      if (event.ledger > highestEventLedger) {
        highestEventLedger = event.ledger;
      }
    }

    // The response always carries a cursor. Only follow it if we hit the full
    // page limit — otherwise we've consumed all available events.
    paginationCursor = response.events.length === BATCH_SIZE ? response.cursor : undefined;
  } while (paginationCursor);

  // ── Advance cursor ────────────────────────────────────────────────────────
  // Save up to (latestLedger - confirmationDepth) so next poll starts from the
  // confirmed tip, giving a small overlap window for any in-flight events.
  const newCursor = Math.max(
    highestEventLedger,
    Math.max(0, latestKnownLedger - CONFIG.confirmationDepth)
  );
  if (newCursor > stored) {
    setCursorLedger(newCursor);
    const boundaryHash = await fetchLedgerHash(newCursor);
    if (boundaryHash) {
      recordLedgerHash(newCursor, boundaryHash);
      await advanceBackfillCheckpoint(newCursor, CONFIG.checkpointIntervalLedgers, canonicalHashAt);
    }
  }
}

/**
 * Start the continuous polling loop.
 * Runs `pollOnce()` immediately, then schedules itself after each cycle.
 * Errors are logged and swallowed so the loop never stops.
 */
export async function startPolling(): Promise<void> {
  console.log(
    `[poller] Starting — polling every ${CONFIG.pollIntervalMs}ms for contract ${CONFIG.contractId}`
  );
  console.log(
    `[poller] Confirmation depth: ${CONFIG.confirmationDepth} ledger(s); ` +
      `confirmed boundary at ~${latestConfirmedLedger(CONFIG.confirmationDepth)}`
  );

  const tick = async () => {
    try {
      await pollOnce();
    } catch (err) {
      console.error('[poller] Error during poll:', err);
    }
    setTimeout(tick, CONFIG.pollIntervalMs);
  };

  await tick();
}
