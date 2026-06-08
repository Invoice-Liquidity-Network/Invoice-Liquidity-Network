export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_READ_TIMEOUT_MS = 10_000;
export const DEFAULT_WRITE_TIMEOUT_MS = 30_000;
export const DEFAULT_SIMULATION_TIMEOUT_MS = 15_000;

export interface RequestTimeouts {
  readMs: number;
  writeMs: number;
  simulationMs: number;
}

export function resolveRequestTimeouts(config: {
  timeoutMs?: number;
  timeouts?: Partial<RequestTimeouts>;
}): RequestTimeouts {
  return {
    readMs: config.timeouts?.readMs ?? config.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    writeMs: config.timeouts?.writeMs ?? config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    simulationMs:
      config.timeouts?.simulationMs ??
      config.timeoutMs ??
      DEFAULT_SIMULATION_TIMEOUT_MS,
  };
}

export async function withTimeout<T>(
  operation: string,
  timeoutMs: number,
  promise: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class TimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms.`);
    this.name = "TimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}
