import { RawHorizonEvent } from "./parse";
import { TimeoutError } from "./errors";

export interface HorizonPage {
  _embedded: {
    records: RawHorizonEvent[];
  };
  _links: {
    next?: { href: string };
    self: { href: string };
  };
}

export interface FetchFn {
  (url: string, init?: RequestInit): Promise<Response>;
}

/**
 * Minimal Horizon HTTP client that handles cursor-based pagination.
 * Accepts an optional custom fetch function for easy testing / mocking.
 */
export class HorizonClient {
  private baseUrl: string;
  private pageSize: number;
  private timeoutMs: number;
  private fetchFn: FetchFn;

  constructor(
    baseUrl: string,
    pageSize: number,
    timeoutMs: number,
    fetchFn?: FetchFn
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.pageSize = pageSize;
    this.timeoutMs = timeoutMs;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /** Build a Horizon /contracts/{contractId}/events URL */
  contractEventsUrl(contractId: string, cursor?: string): string {
    const params = new URLSearchParams({
      limit: String(this.pageSize),
      order: "asc",
    });
    if (cursor) params.set("cursor", cursor);
    return `${this.baseUrl}/contracts/${contractId}/events?${params}`;
  }

  /** Build a Horizon /accounts/{address}/transactions URL */
  accountTransactionsUrl(address: string, cursor?: string): string {
    const params = new URLSearchParams({
      limit: String(this.pageSize),
      order: "asc",
    });
    if (cursor) params.set("cursor", cursor);
    return `${this.baseUrl}/accounts/${address}/transactions?${params}`;
  }

  /** Fetch a single page from any Horizon URL */
  async fetchPage(url: string): Promise<HorizonPage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Horizon responded with HTTP ${res.status}: ${url}`);
      }
      return (await res.json()) as HorizonPage;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        throw new TimeoutError("Horizon fetchPage", this.timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch ALL pages from a starting URL, yielding records page by page.
   * Stops when a page returns 0 records or there is no `next` link.
   */
  async *paginateAll(startUrl: string): AsyncGenerator<RawHorizonEvent[]> {
    let url: string | undefined = startUrl;

    while (url) {
      const page = await this.fetchPage(url);
      const records = page._embedded?.records ?? [];

      if (records.length === 0) break;

      yield records;

      // Follow the `next` cursor link if present
      url = page._links?.next?.href;
    }
  }

  /**
   * Open a Horizon SSE stream and call onEvent for each message.
   * Returns an AbortController so the caller can close the stream.
   */
  openStream(
    url: string,
    onEvent: (raw: RawHorizonEvent) => void,
    onError?: (err: Error) => void
  ): AbortController {
    const controller = new AbortController();
    const sseUrl = url.includes("?")
      ? `${url}&accept=text/event-stream`
      : `${url}?accept=text/event-stream`;

    this.fetchFn(sseUrl, {
      signal: controller.signal,
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
              if (data === "" || data === "\"hello\"") continue;
              try {
                const event = JSON.parse(data) as RawHorizonEvent;
                onEvent(event);
              } catch {
                // skip malformed SSE frames
              }
            }
          }
        }
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          onError?.(err);
        }
      });

    return controller;
  }
}
