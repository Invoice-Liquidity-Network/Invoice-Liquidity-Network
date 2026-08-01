import type { PipelineEvent } from "./subscriber";

export interface SorobanStreamOptions<T = unknown> {
  url: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  parse?: (data: string) => PipelineEvent<T>;
}

export interface StreamHandle {
  close(): void;
}

function defaultParse<T>(data: string): PipelineEvent<T> {
  const value = JSON.parse(data) as Record<string, unknown>;
  const event = (value.event ?? value) as Record<string, unknown>;
  if (
    typeof event.id !== "string" ||
    typeof event.ledger !== "number" ||
    typeof event.type !== "string"
  ) {
    throw new Error("Invalid Soroban stream event");
  }
  return event as unknown as PipelineEvent<T>;
}

export function startSorobanStream<T>(
  options: SorobanStreamOptions<T>,
  onEvent: (event: PipelineEvent<T>) => Promise<void>,
  onError?: (error: unknown) => void,
): StreamHandle {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }

  let stopped = false;
  const parse = options.parse ?? defaultParse;

  void (async () => {
    let delay = options.reconnectBaseDelayMs ?? 250;
    const maxDelay = options.reconnectMaxDelayMs ?? 10_000;

    while (!stopped) {
      try {
        const response = await (options.fetchFn ?? fetch)(options.url, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Soroban SSE request failed with status ${response.status}`);
        }

        delay = options.reconnectBaseDelayMs ?? 250;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopped) {
          const result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          const records = buffer.split(/\r?\n\r?\n/);
          buffer = records.pop() ?? "";

          for (const record of records) {
            const data = record
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (data) await onEvent(parse(data));
          }
        }
      } catch (error) {
        const errorName =
          typeof error === "object" && error !== null && "name" in error
            ? (error as { name?: unknown }).name
            : undefined;
        if (stopped || errorName === "AbortError") break;
        onError?.(error);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(maxDelay, delay * 2);
      }
    }
  })();

  return {
    close(): void {
      stopped = true;
      controller.abort();
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}
