import type { rpc } from '@stellar/stellar-sdk';
import { CONFIG } from './config';
import { getCursorLedger, setCursorLedger } from './db';
import { processEvent, processScheduledNotifications } from './processor';
import { server } from './rpc';
import { isRetryableError, normalizeError } from './errors';

const BATCH_SIZE = 200;

/** Maximum number of consecutive retryable errors before the poller gives up. */
const MAX_CONSECUTIVE_RETRIES = 5;

/** Base delay in ms for exponential backoff on retryable errors. */
const RETRY_BASE_DELAY_MS = 2_000;

export async function pollOnce(): Promise<void> {
  const stored = getCursorLedger();

  let startLedger: number;
  if (stored === 0) {
    if (CONFIG.startLedger > 0) {
      startLedger = CONFIG.startLedger;
    } else {
      const latest = await server.getLatestLedger();
      startLedger = Math.max(1, latest.sequence - 1_000);
    }
  } else {
    startLedger = stored;
  }

  const filters: rpc.Api.EventFilter[] = [{ type: 'contract', contractIds: [CONFIG.contractId] }];
  let paginationCursor: string | undefined;
  let highestEventLedger = stored;
  let latestKnownLedger = stored;

  do {
    const request: rpc.Api.GetEventsRequest = paginationCursor
      ? { cursor: paginationCursor, filters, limit: BATCH_SIZE }
      : { startLedger, filters, limit: BATCH_SIZE };

    let response: rpc.Api.GetEventsResponse;
    try {
      response = await server.getEvents(request);
    } catch (err) {
      const ilnErr = normalizeError(err, 'RPC_ERROR', 'Failed to fetch events');
      console.error(`[poller] ${ilnErr.code}: ${ilnErr.message}`, {
        retryable: ilnErr.retryable,
        startLedger,
        paginationCursor,
      });
      throw ilnErr;
    }

    latestKnownLedger = response.latestLedger;

    for (const event of response.events) {
      await processEvent(event);
      if (event.ledger > highestEventLedger) {
        highestEventLedger = event.ledger;
      }
    }

    paginationCursor = response.events.length === BATCH_SIZE ? response.cursor : undefined;
  } while (paginationCursor);

  const newCursor = Math.max(highestEventLedger, Math.max(0, latestKnownLedger - 1));
  if (newCursor > stored) {
    setCursorLedger(newCursor);
  }

  await processScheduledNotifications();
}

export async function startPolling(): Promise<void> {
  console.log(
    `[poller] Starting — polling every ${CONFIG.pollIntervalMs}ms for contract ${CONFIG.contractId}`
  );

  let consecutiveRetryableErrors = 0;

  const tick = async () => {
    try {
      await pollOnce();
      consecutiveRetryableErrors = 0;
    } catch (err) {
      const ilnErr = normalizeError(err);

      if (isRetryableError(ilnErr)) {
        consecutiveRetryableErrors++;
        if (consecutiveRetryableErrors >= MAX_CONSECUTIVE_RETRIES) {
          console.error(
            `[poller] ${MAX_CONSECUTIVE_RETRIES} consecutive retryable errors. Pausing for extended backoff.`,
            { code: ilnErr.code, message: ilnErr.message }
          );
          // Extended backoff: wait longer before next attempt
          setTimeout(tick, CONFIG.pollIntervalMs * 5);
          consecutiveRetryableErrors = 0;
          return;
        }

        const backoffMs = RETRY_BASE_DELAY_MS * Math.pow(2, consecutiveRetryableErrors - 1);
        console.warn(
          `[poller] Retryable error (${consecutiveRetryableErrors}/${MAX_CONSECUTIVE_RETRIES}). Retrying in ${backoffMs}ms.`,
          { code: ilnErr.code, message: ilnErr.message }
        );
        setTimeout(tick, backoffMs);
        return;
      }

      // Non-retryable error: log and continue with normal interval
      console.error('[poller] Non-retryable error during poll:', ilnErr.code, ilnErr.message);
      consecutiveRetryableErrors = 0;
    }
    setTimeout(tick, CONFIG.pollIntervalMs);
  };

  await tick();
}
