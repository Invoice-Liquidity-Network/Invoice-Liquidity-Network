export interface PipelineEvent<T = unknown> {
  id: string;
  type: string;
  ledger: number;
  data?: T;
  [key: string]: unknown;
}

export interface EventSubscriber<T = unknown> {
  onEvent(event: PipelineEvent<T>): Promise<void> | void;
}
