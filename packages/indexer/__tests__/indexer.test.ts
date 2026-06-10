import { ILNEventIndexer } from "../src/indexer";
import { TimeoutError } from "../src/errors";
import { ContractEvent } from "../src/types";
import { RawHorizonEvent } from "../src/parse";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRawEvent(overrides: Partial<RawHorizonEvent> = {}): RawHorizonEvent {
  return {
    type: "InvoiceCreated",
    contract_id: "CTEST_CONTRACT",
    topics: ["invoice-001", "addr-seller"],
    value: "dGVzdA==", // base64 "test"
    ledger: 1000,
    ledger_closed_at: "2024-06-01T10:00:00Z",
    tx_hash: "abc123",
    paging_token: "1000-0",
    ...overrides,
  };
}

/** Build a mock fetch that returns Horizon pages */
function mockFetch(pages: RawHorizonEvent[][]): jest.Mock {
  let callIndex = 0;
  return jest.fn().mockImplementation(() => {
    const records = pages[callIndex] ?? [];
    callIndex++;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          _embedded: { records },
          _links: {
            self: { href: "https://horizon.stellar.org/contracts/test/events?cursor=&limit=200&order=asc" },
            // Only provide `next` if there's a subsequent page with content
            ...(pages[callIndex] !== undefined && pages[callIndex].length > 0
              ? { next: { href: `https://horizon.stellar.org/next?page=${callIndex}` } }
              : {}),
          },
        }),
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ILNEventIndexer", () => {
  const CONTRACT_ID = "CTEST_CONTRACT";

  // ── getEventsForInvoice ──────────────────────────────────────────────────

  describe("getEventsForInvoice", () => {
    it("throws TimeoutError when a Horizon query exceeds the configured timeout", async () => {
      jest.useFakeTimers();

      const fetchMock = jest.fn((_url: string, init?: RequestInit): Promise<Response> => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });
      const indexer = new ILNEventIndexer(
        CONTRACT_ID,
        { timeoutMs: 25 },
        fetchMock
      );

      const promise = indexer.getEventsForInvoice("invoice-001");
      const assertion = expect(promise).rejects.toMatchObject({
        name: "TimeoutError",
        operation: "Horizon fetchPage",
        timeoutMs: 25,
      });

      jest.advanceTimersByTime(25);

      await assertion;
      await expect(promise).rejects.toBeInstanceOf(TimeoutError);

      jest.useRealTimers();
    });

    it("returns events whose first topic matches the invoice id", async () => {
      const events = [
        makeRawEvent({ topics: ["invoice-001", "addr-A"], tx_hash: "tx1" }),
        makeRawEvent({ topics: ["invoice-002", "addr-B"], tx_hash: "tx2" }),
        makeRawEvent({ topics: ["invoice-001", "addr-C"], tx_hash: "tx3" }),
      ];

      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, mockFetch([events]));
      const result = await indexer.getEventsForInvoice("invoice-001");

      expect(result).toHaveLength(2);
      expect(result.map((e) => e.txHash)).toEqual(["tx1", "tx3"]);
    });

    it("returns empty array when no events match", async () => {
      const events = [
        makeRawEvent({ topics: ["invoice-999"], tx_hash: "tx1" }),
      ];

      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, mockFetch([events]));
      const result = await indexer.getEventsForInvoice("invoice-001");

      expect(result).toHaveLength(0);
    });

    it("handles empty Horizon response", async () => {
      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, mockFetch([[]]));
      const result = await indexer.getEventsForInvoice("invoice-001");
      expect(result).toHaveLength(0);
    });
  });

  // ── pagination ───────────────────────────────────────────────────────────

  describe("pagination", () => {
    it("fetches across multiple pages", async () => {
      const page1 = [
        makeRawEvent({ tx_hash: "tx1", paging_token: "1", topics: ["invoice-001"] }),
        makeRawEvent({ tx_hash: "tx2", paging_token: "2", topics: ["invoice-001"] }),
      ];
      const page2 = [
        makeRawEvent({ tx_hash: "tx3", paging_token: "3", topics: ["invoice-001"] }),
      ];

      const fetchMock = mockFetch([page1, page2]);
      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, fetchMock);
      const result = await indexer.getEventsForInvoice("invoice-001");

      expect(result).toHaveLength(3);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // ── getEventsForAddress ──────────────────────────────────────────────────

  describe("getEventsForAddress", () => {
    it("returns all events for an address when no type filter given", async () => {
      const events = [
        makeRawEvent({ type: "InvoiceCreated", tx_hash: "tx1" }),
        makeRawEvent({ type: "LiquidityAdded", tx_hash: "tx2" }),
      ];

      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, mockFetch([events]));
      const result = await indexer.getEventsForAddress("GADDR123");

      expect(result).toHaveLength(2);
    });

    it("filters by event type when types array is provided", async () => {
      const events = [
        makeRawEvent({ type: "InvoiceCreated", tx_hash: "tx1" }),
        makeRawEvent({ type: "LiquidityAdded", tx_hash: "tx2" }),
        makeRawEvent({ type: "InvoiceRepaid", tx_hash: "tx3" }),
      ];

      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, mockFetch([events]));
      const result = await indexer.getEventsForAddress("GADDR123", [
        "InvoiceCreated",
        "InvoiceRepaid",
      ]);

      expect(result).toHaveLength(2);
      expect(result.map((e) => e.type)).toEqual([
        "InvoiceCreated",
        "InvoiceRepaid",
      ]);
    });
  });

  // ── getEventsSince ───────────────────────────────────────────────────────

  describe("getEventsSince", () => {
    it("returns only events at or after the given unix timestamp", async () => {
      const events = [
        makeRawEvent({ ledger_closed_at: "2024-01-01T00:00:00Z", tx_hash: "tx1" }),
        makeRawEvent({ ledger_closed_at: "2024-06-01T10:00:00Z", tx_hash: "tx2" }),
        makeRawEvent({ ledger_closed_at: "2025-01-01T00:00:00Z", tx_hash: "tx3" }),
      ];

      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, mockFetch([events]));
      // Unix timestamp for 2024-06-01T00:00:00Z
      const cutoff = new Date("2024-06-01T00:00:00Z").getTime() / 1000;
      const result = await indexer.getEventsSince(cutoff);

      expect(result).toHaveLength(2);
      expect(result.map((e) => e.txHash)).toEqual(["tx2", "tx3"]);
    });

    it("accepts an ISO-8601 string timestamp", async () => {
      const events = [
        makeRawEvent({ ledger_closed_at: "2023-12-31T23:59:59Z", tx_hash: "old" }),
        makeRawEvent({ ledger_closed_at: "2024-01-02T00:00:00Z", tx_hash: "new" }),
      ];

      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, mockFetch([events]));
      const result = await indexer.getEventsSince("2024-01-01T00:00:00Z");

      expect(result).toHaveLength(1);
      expect(result[0].txHash).toBe("new");
    });
  });

  // ── subscribe (SSE streaming) ────────────────────────────────────────────

  describe("subscribe", () => {
    it("calls callback with parsed events from SSE stream", async () => {
      const rawEvent = makeRawEvent({ tx_hash: "stream-tx1" });
      const sseData = `data: ${JSON.stringify(rawEvent)}\n\n`;

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: stream,
      });

      const received: ContractEvent[] = [];
      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, fetchMock);

      const sub = indexer.subscribe((event) => {
        received.push(event);
      });

      // Give async stream reading time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));
      sub.close();

      expect(received).toHaveLength(1);
      expect(received[0].txHash).toBe("stream-tx1");
    });

    it("close() stops the stream without throwing", async () => {
      // Stream that never ends
      const stream = new ReadableStream({ start() {} });
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: stream,
      });

      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, fetchMock);
      const sub = indexer.subscribe(jest.fn());

      expect(() => sub.close()).not.toThrow();
    });

    it("calls onError when fetch fails", async () => {
      const fetchMock = jest.fn().mockRejectedValue(new Error("Network error"));

      const errors: Error[] = [];
      const indexer = new ILNEventIndexer(CONTRACT_ID, {}, fetchMock);
      const sub = indexer.subscribe(jest.fn(), (err) => errors.push(err));

      await new Promise((resolve) => setTimeout(resolve, 50));
      sub.close();

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("Network error");
    });
  });

  // ── parseContractEvent ───────────────────────────────────────────────────

  describe("parseContractEvent (unit)", () => {
    it("maps raw Horizon event fields to ContractEvent shape", async () => {
      const { parseContractEvent } = await import("../src/parse");
      const raw = makeRawEvent();
      const parsed = parseContractEvent(raw);

      expect(parsed.contractId).toBe("CTEST_CONTRACT");
      expect(parsed.type).toBe("InvoiceCreated");
      expect(parsed.txHash).toBe("abc123");
      expect(parsed.ledger).toBe(1000);
      expect(parsed.pagingToken).toBe("1000-0");
    });

    it("handles missing optional fields gracefully", async () => {
      const { parseContractEvent } = await import("../src/parse");
      const raw: RawHorizonEvent = { type: "Unknown" };
      const parsed = parseContractEvent(raw);

      expect(parsed.contractId).toBe("");
      expect(parsed.txHash).toBe("");
      expect(parsed.topics).toEqual([]);
      expect(parsed.value).toBeNull();
    });
  });
});
