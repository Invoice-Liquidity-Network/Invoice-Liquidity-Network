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
