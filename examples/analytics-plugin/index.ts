import type { ILNPlugin, PluginContext } from '@iln/sdk';

export interface AnalyticsConfig {
  endpoint?: string;
  apiKey?: string;
  batchSize?: number;
}

export interface OperationMetrics {
  count: number;
  successCount: number;
  errorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

interface PendingEvent {
  operation: string;
  outcome: 'success' | 'error';
  durationMs: number;
  timestamp: number;
}

/**
 * Analytics plugin for the ILN SDK.
 *
 * Tracks per-operation counts, success/error rates, and timing. Optionally
 * flushes batched events to a remote analytics endpoint.
 *
 * @example
 * ```ts
 * import { ILNSdk } from '@iln/sdk';
 * import { AnalyticsPlugin } from './examples/analytics-plugin';
 *
 * const sdk = new ILNSdk({ ... });
 * const analytics = new AnalyticsPlugin({ batchSize: 5 });
 * await sdk.plugins.register(analytics);
 *
 * // ... perform operations ...
 *
 * console.log(analytics.getReport());
 * ```
 */
export class AnalyticsPlugin implements ILNPlugin {
  readonly name = 'iln-analytics';
  readonly version = '1.0.0';

  private readonly config: Required<AnalyticsConfig>;
  private readonly metrics = new Map<string, OperationMetrics>();
  private readonly startTimeStacks = new Map<string, number[]>();
  private readonly pendingEvents: PendingEvent[] = [];
  private ctx: PluginContext | null = null;

  constructor(config: AnalyticsConfig = {}) {
    this.config = {
      endpoint: config.endpoint ?? '',
      apiKey: config.apiKey ?? '',
      batchSize: config.batchSize ?? 10,
    };
  }

  async install(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger('Analytics plugin installed', {
      endpoint: this.config.endpoint || '(none)',
      batchSize: this.config.batchSize,
    });
  }

  onBeforeOperation(name: string, _params: unknown): void {
    const stack = this.startTimeStacks.get(name) ?? [];
    stack.push(Date.now());
    this.startTimeStacks.set(name, stack);
  }

  async onAfterOperation(name: string, _result: unknown): Promise<void> {
    const durationMs = this.popDuration(name);
    const m = this.getOrCreate(name);
    m.count++;
    m.successCount++;
    m.totalDurationMs += durationMs;
    m.avgDurationMs = m.totalDurationMs / m.count;

    this.pendingEvents.push({
      operation: name,
      outcome: 'success',
      durationMs,
      timestamp: Date.now(),
    });
    await this.maybeFlush();
  }

  async onError(name: string, _error: unknown): Promise<void> {
    const durationMs = this.popDuration(name);
    const m = this.getOrCreate(name);
    m.count++;
    m.errorCount++;
    m.totalDurationMs += durationMs;
    m.avgDurationMs = m.totalDurationMs / m.count;

    this.pendingEvents.push({
      operation: name,
      outcome: 'error',
      durationMs,
      timestamp: Date.now(),
    });
    await this.maybeFlush();
  }

  async destroy(): Promise<void> {
    if (this.pendingEvents.length > 0) {
      await this.flush();
    }
    this.ctx?.logger('Analytics plugin destroyed');
  }

  /** Returns a snapshot of all collected metrics keyed by operation name. */
  getReport(): Record<string, OperationMetrics> {
    const report: Record<string, OperationMetrics> = {};
    for (const [name, m] of this.metrics) {
      report[name] = { ...m };
    }
    return report;
  }

  private getOrCreate(name: string): OperationMetrics {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        count: 0,
        successCount: 0,
        errorCount: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
      });
    }
    return this.metrics.get(name)!;
  }

  private popDuration(name: string): number {
    const stack = this.startTimeStacks.get(name);
    const start = stack?.pop() ?? Date.now();
    return Date.now() - start;
  }

  private async maybeFlush(): Promise<void> {
    if (this.config.endpoint && this.pendingEvents.length >= this.config.batchSize) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (!this.config.endpoint || this.pendingEvents.length === 0) return;
    const batch = this.pendingEvents.splice(0, this.pendingEvents.length);
    try {
      await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({ events: batch }),
      });
    } catch {
      // Swallow flush errors — analytics should never break the main SDK flow.
    }
  }
}
