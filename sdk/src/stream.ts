/**
 * A minimally-parsed Soroban RPC/Horizon contract event as delivered over
 * the raw SSE stream — before any invoice-domain decoding. Distinct from
 * `@iln/shared`'s `ContractEvent`, which is the already-decoded, invoice-
 * domain-specific discriminated union.
 */
export interface RawContractEvent {
  contractId: string;
  type: string;
  topics: unknown[];
  value: unknown;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  pagingToken: string;
}

type OnEvent = (e: RawContractEvent) => void | Promise<void>;
type OnError = (err: Error) => void | undefined;

/**
 * Server-Sent Events (SSE) stream with automatic reconnection.
 * Used internally for real-time event subscriptions.
 *
 * @example
 * ```ts
 * const stream = new SSEStream(
 *   "https://rpc.example.com/contracts/.../events",
 *   (event) => console.log("Event:", event),
 *   (err) => console.error("SSE error:", err),
 * );
 *
 * // Later, close the stream
 * stream.close();
 * ```
 */
export class SSEStream {
  private url: string;
  private onEvent: OnEvent;
  private onError?: OnError;
  private controller?: AbortController;
  private closed = false;
  private reconnectDelay = 1000;
  private readonly maxDelay = 30000;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  /**
   * Create a new SSE stream connection.
   *
   * @param url - The SSE endpoint URL.
   * @param onEvent - Callback invoked for each parsed event.
   * @param onError - Optional callback invoked on stream errors.
   */
  constructor(url: string, onEvent: OnEvent, onError?: OnError) {
    this.url = url;
    this.onEvent = onEvent;
    this.onError = onError;
    this.open();
  }

  private open() {
    if (this.closed) return;

    this.controller = new AbortController();
    const sseUrl = this.url.includes('?')
      ? `${this.url}&accept=text/event-stream`
      : `${this.url}?accept=text/event-stream`;

    globalThis
      .fetch(sseUrl, {
        signal: this.controller.signal,
        headers: { Accept: 'text/event-stream' },
      })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          throw new Error(`SSE stream failed: HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // eslint-disable-next-line no-constant-condition -- reads until the stream signals done
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              if (data === '' || data === '"hello"') continue;
              try {
                const raw = JSON.parse(data) as Record<string, unknown>;
                const ev: RawContractEvent = {
                  contractId: (raw.contract_id as string) ?? '',
                  type: (raw.type as string) ?? '',
                  topics: (raw.topics as unknown[]) ?? [],
                  value: raw.value ?? null,
                  ledger: (raw.ledger as number) ?? 0,
                  ledgerClosedAt: (raw.ledger_closed_at as string) ?? '',
                  txHash: (raw.tx_hash as string) ?? '',
                  pagingToken: (raw.paging_token as string) ?? '',
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
        if (err.name === 'AbortError') return;
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

  /**
   * Close the SSE stream and prevent automatic reconnection.
   */
  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.controller?.abort();
  }
}

/**
 * Open a Server-Sent Events connection to the Stellar RPC event stream.
 *
 * @param url - The SSE endpoint URL.
 * @param onEvent - Callback invoked for each parsed contract event.
 * @param onError - Optional callback invoked on stream errors.
 * @returns An object with a `close()` method to terminate the stream.
 *
 * @example
 * ```ts
 * const handle = openSSE(
 *   "https://soroban-testnet.stellar.org/contracts/.../events",
 *   (event) => console.log("Event:", event.type, event.value),
 * );
 *
 * // Later, close the stream
 * handle.close();
 * ```
 */
export function openSSE(url: string, onEvent: OnEvent, onError?: OnError) {
  const s = new SSEStream(url, onEvent, onError);
  return { close: () => s.close() };
}
