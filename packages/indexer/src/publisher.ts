import type { EventSubscriber, PipelineEvent } from "./subscriber";

export class EventPublisher<T = unknown> {
  private readonly subscribers = new Set<EventSubscriber<T>>();
  private pending = 0;

  subscribe(subscriber: EventSubscriber<T>): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async publish(event: PipelineEvent<T>): Promise<void> {
    this.pending++;
    try {
      const deliveries = [...this.subscribers].map((subscriber) =>
        Promise.resolve().then(() => subscriber.onEvent(event)),
      );
      const results = await Promise.allSettled(deliveries);
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) throw failure.reason;
    } finally {
      this.pending--;
    }
  }

  get lag(): number {
    return this.pending;
  }
}
