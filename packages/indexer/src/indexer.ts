import { HorizonClient, FetchFn } from "./horizon-client";
import { parseContractEvent, RawHorizonEvent } from "./parse";
import {
  ParsedHorizonEvent,
  EventCallback,
  ILNEventType,
  IndexerOptions,
  SubscriptionHandle,
} from "./types";

const DEFAULT_HORIZON_URL = "https://horizon.stellar.org";
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * ILNEventIndexer
 *
 * A reusable Horizon event indexer for the Invoice Liquidity Network protocol.
 * Encapsulates cursor-based pagination, event parsing, and SSE streaming.
 *
 * @example
 * ```ts
 * const indexer = new ILNEventIndexer({ horizonUrl: "https://horizon.stellar.org" });
 *
 * // Fetch all events for an invoice
 * const events = await indexer.getEventsForInvoice("invoice-contract-id");
 *
 * // Stream new events in real time
 * const sub = indexer.subscribe((event) => console.log(event));
 * // later...
 * sub.close();
 * ```
 */
export class ILNEventIndexer {
  private client: HorizonClient;
  /** The ILN contract address to index events against. */
  private contractId: string;

  constructor(
    contractId: string,
    options: IndexerOptions = {},
    fetchFn?: FetchFn
  ) {
    this.contractId = contractId;

    this.client = new HorizonClient(
      options.horizonUrl ?? DEFAULT_HORIZON_URL,
      options.pageSize ?? DEFAULT_PAGE_SIZE,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchFn
    );
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Fetch all contract events related to a specific invoice ID.
   * Filters by matching the first topic (invoice ID) in emitted events.
   *
   * @param id  The invoice identifier (contract topic value)
   */
  async getEventsForInvoice(id: string): Promise<ParsedHorizonEvent[]> {
    const all = await this._fetchAllContractEvents();
    return all.filter((e) => {
      // ILN events encode the invoice ID as the first topic
      const firstTopic = e.topics[0];
      return firstTopic === id;
    });
  }

  /**
   * Fetch all contract events associated with a specific Stellar address.
   * Optionally filter by one or more event types.
   *
   * @param address  Stellar account / contract address (G... or C...)
   * @param types    Optional list of event types to keep
   */
  async getEventsForAddress(
    address: string,
    types?: ILNEventType[]
  ): Promise<ParsedHorizonEvent[]> {
    const startUrl = this.client.accountTransactionsUrl(address);
    const events: ParsedHorizonEvent[] = [];

    for await (const records of this.client.paginateAll(startUrl)) {
      for (const raw of records) {
        const event = parseContractEvent(raw);
        if (!types || types.includes(event.type)) {
          events.push(event);
        }
      }
    }

    return events;
  }

  /**
   * Fetch all contract events emitted since a given timestamp.
   *
   * @param timestamp  Unix epoch seconds (or ISO-8601 string)
   */
  async getEventsSince(timestamp: number | string): Promise<ParsedHorizonEvent[]> {
    const cutoff =
      typeof timestamp === "number"
        ? new Date(timestamp * 1000)
        : new Date(timestamp);

    const all = await this._fetchAllContractEvents();
    return all.filter((e) => new Date(e.ledgerClosedAt) >= cutoff);
  }

  /**
   * Subscribe to a real-time SSE stream of new contract events.
   * The callback is invoked for every new event as it arrives.
   *
   * @param callback  Invoked with each new ContractEvent
   * @param onError   Optional error handler (stream errors, parse failures)
   * @returns         A SubscriptionHandle — call .close() to stop the stream
   *
   * @example
   * ```ts
   * const sub = indexer.subscribe((event) => {
   *   console.log("New event:", event.type, event.txHash);
   * });
   *
   * // Stop after 60 seconds
   * setTimeout(() => sub.close(), 60_000);
   * ```
   */
  subscribe(
    callback: EventCallback,
    onError?: (err: Error) => void
  ): SubscriptionHandle {
    const streamUrl = this.client.contractEventsUrl(this.contractId);

    const abortController = this.client.openStream(
      streamUrl,
      (raw: RawHorizonEvent) => {
        try {
          const event = parseContractEvent(raw);
          void callback(event);
        } catch (err) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      },
      onError
    );

    return {
      close() {
        abortController.abort();
      },
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Fetch and parse every page of events for this.contractId.
   */
  private async _fetchAllContractEvents(): Promise<ParsedHorizonEvent[]> {
    const startUrl = this.client.contractEventsUrl(this.contractId);
    const events: ParsedHorizonEvent[] = [];

    for await (const records of this.client.paginateAll(startUrl)) {
      for (const raw of records) {
        events.push(parseContractEvent(raw));
      }
    }

    return events;
  }
}