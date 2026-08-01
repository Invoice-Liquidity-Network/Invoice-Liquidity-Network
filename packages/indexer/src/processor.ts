import { EventDeduplicator } from "./dedup";
import { LedgerOrdering } from "./ordering";
import { EventPublisher } from "./publisher";
import type { EventSubscriber, PipelineEvent } from "./subscriber";

export interface ProcessorOptions<T, E = T> {
  eventTypes: ReadonlySet<string>;
  deduplicator: EventDeduplicator;
  publisher: EventPublisher<E>;
  ordering?: LedgerOrdering<PipelineEvent<T>>;
  enrich?: (event: PipelineEvent<T>) => Promise<PipelineEvent<E>>;
  validate?: (event: PipelineEvent<T>) => void;
}

export class EventProcessor<T = unknown, E = T> {
  private readonly options: ProcessorOptions<T, E>;
  private processed = 0;
  private rejected = 0;

  constructor(options: ProcessorOptions<T, E>) {
    this.options = options;
  }

  subscribe(subscriber: EventSubscriber<E>): () => void {
    return this.options.publisher.subscribe(subscriber);
  }

  async process(event: PipelineEvent<T>): Promise<boolean> {
    this.validate(event);
    if (await this.options.deduplicator.isDuplicate(event.id)) return false;

    const dispatch = async (next: PipelineEvent<T>): Promise<void> => {
      const enriched = this.options.enrich
        ? await this.options.enrich(next)
        : (next as unknown as PipelineEvent<E>);
      await this.options.publisher.publish(enriched);
      await this.options.deduplicator.mark(next.id);
      this.processed++;
    };

    if (this.options.ordering) {
      this.options.ordering.add(event);
      await this.options.ordering.flush(dispatch);
    } else {
      await dispatch(event);
    }
    return true;
  }

  private validate(event: PipelineEvent<T>): void {
    try {
      if (!event || typeof event.id !== "string" || event.id.length === 0) {
        throw new Error("Event id is required");
      }
      if (!Number.isSafeInteger(event.ledger) || event.ledger < 0) {
        throw new Error("Event ledger must be a non-negative safe integer");
      }
      if (typeof event.type !== "string" || !this.options.eventTypes.has(event.type)) {
        throw new Error(`Unsupported event type: ${event.type}`);
      }
      this.options.validate?.(event);
    } catch (error) {
      this.rejected++;
      throw error;
    }
  }

  get metrics(): { processed: number; rejected: number; lag: number } {
    return {
      processed: this.processed,
      rejected: this.rejected,
      lag: this.options.publisher.lag,
    };
  }
}
