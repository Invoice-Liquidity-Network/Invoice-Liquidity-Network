import type { rpc } from '@stellar/stellar-sdk';
import { CONFIG } from './config';
import { getCursorLedger, setCursorLedger } from './db';
import { processEvent, processScheduledNotifications } from './processor';
import { server } from './rpc';

const BATCH_SIZE = 200;

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

    const response = await server.getEvents(request);
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
