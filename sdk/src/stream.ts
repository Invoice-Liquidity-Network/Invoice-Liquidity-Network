import type { ContractEvent } from "./types";

type OnEvent = (e: ContractEvent) => void | Promise<void>;
type OnError = (err: Error) => void | undefined;

export class SSEStream {
  private url: string;
  private onEvent: OnEvent;
  private onError?: OnError;
  private controller?: AbortController;
  private closed = false;
  private reconnectDelay = 1000;
  private readonly maxDelay = 30000;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(url: string, onEvent: OnEvent, onError?: OnError) {
    this.url = url;
    this.onEvent = onEvent;
    this.onError = onError;
    this.open();
  }

  private open() {
    if (this.closed) return;

    this.controller = new AbortController();
    const sseUrl = this.url.includes("?") ? `${this.url}&accept=text/event-stream` : `${this.url}?accept=text/event-stream`;

    globalThis.fetch(sseUrl, {
      signal: this.controller.signal,
      headers: { Accept: "text/event-stream" },
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          throw new Error(`SSE stream failed: HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              if (data === "" || data === '"hello"') continue;
              try {
                const raw = JSON.parse(data) as Record<string, unknown>;
                const ev: ContractEvent = {
                  contractId: (raw.contract_id as string) ?? "",
                  type: (raw.type as string) ?? "",
                  topics: (raw.topics as unknown[]) ?? [],
                  value: raw.value ?? null,
                  ledger: (raw.ledger as number) ?? 0,
                  ledgerClosedAt: (raw.ledger_closed_at as string) ?? "",
                  txHash: (raw.tx_hash as string) ?? "",
                  pagingToken: (raw.paging_token as string) ?? "",
                };

                await this.onEvent(ev);
              } catch (err) {
                // ignore malformed frames
              }
            }
          }
        }
      })
      .then(() => {
        // closed naturally — schedule reconnect if not intentionally closed
        if (!this.closed) this.scheduleReconnect();
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        this.onError?.(err);
        this.scheduleReconnect();
      });
  }

  private scheduleReconnect() {
    if (this.closed) return;

    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);

    this.reconnectTimer = setTimeout(() => {
      this.open();
    }, delay);
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.controller?.abort();
  }
}

export function openSSE(url: string, onEvent: OnEvent, onError?: OnError) {
  const s = new SSEStream(url, onEvent, onError);
  return { close: () => s.close() };
}
