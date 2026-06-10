import { describe, it, expect, vi } from "vitest";
import { openSSE } from "../src/stream";
import type { ContractEvent } from "../src/types";

function makeStreamFromMessages(messages: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= messages.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(messages[i++] + "\n"));
    },
  });
}

describe("SSE stream helper", () => {
  it("calls callback for SSE data frames", async () => {
    const payload = JSON.stringify({ type: "InvoiceFunded", contract_id: "C1", topics: ["1"], value: "", ledger: 123, ledger_closed_at: "t", tx_hash: "h", paging_token: "p" });
    // prepare a stream that emits a data: line then ends
    const body = makeStreamFromMessages([`data: ${payload}`]);

    // mock fetch
    // @ts-ignore
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body });

    const received: ContractEvent[] = [];
    const handle = openSSE("https://example.com/contracts/C1/events", (ev) => {
      received.push(ev as ContractEvent);
    });

    // wait briefly for stream to be consumed
    await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBeGreaterThan(0);
    expect(received[0].type).toBe("InvoiceFunded");

    handle.close();
  });
});
