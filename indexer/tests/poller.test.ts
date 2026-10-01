import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, getCursorLedger, setCursorLedger, setDb } from "../src/db";
import { pollOnce } from "../src/poller";
import { processEvent } from "../src/processor";

vi.mock("../src/rpc", () => ({
  fetchInvoice: vi.fn(),
  server: { getEvents: vi.fn() },
}));

import { fetchInvoice, server } from "../src/rpc";

function makeEvent() {
  return {
    id: "reorg-overlap-event",
    pagingToken: "reorg-overlap-event",
    type: "contract",
    ledger: 100,
    ledgerClosedAt: "2024-01-01T00:00:00Z",
    contractId: "CTEST",
    topic: [xdr.ScVal.scvSymbol("submitted")],
    value: nativeToScVal(1n, { type: "u64" }),
    inSuccessfulContractCall: true,
  } as any;
}

describe("pollOnce ledger overlap", () => {
  beforeEach(() => {
    setDb(createDb(":memory:"));
    setCursorLedger(100);
    vi.mocked(fetchInvoice).mockReset().mockResolvedValue(null);
    vi.mocked(server.getEvents).mockReset();
  });

  it("rescans the saved cursor ledger and ignores an already-processed boundary event", async () => {
    const event = makeEvent();
    await processEvent(event);
    vi.mocked(fetchInvoice).mockClear();
    vi.mocked(server.getEvents).mockResolvedValue({
      events: [event],
      latestLedger: 101,
      cursor: "next-page",
    } as any);

    await pollOnce();

    expect(server.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 100 }),
    );
    expect(fetchInvoice).not.toHaveBeenCalled();
    expect(getCursorLedger()).toBe(100);
  });
});
