import type { PipelineEvent } from "./subscriber";

export class LedgerOrdering<T extends PipelineEvent = PipelineEvent> {
  private readonly queue: T[] = [];
  private flushing = false;

  add(event: T): void {
    this.queue.push(event);
    this.queue.sort((a, b) => a.ledger - b.ledger || a.id.localeCompare(b.id));
  }

  async flush(handler: (event: T) => Promise<void>): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift();
        if (event) await handler(event);
      }
    } finally {
      this.flushing = false;
    }
  }
}
