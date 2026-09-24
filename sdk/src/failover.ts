import { rpc } from '@stellar/stellar-sdk';

import { isTransientError } from './backoff';
import { ValidationError } from './errors';
import { createLogger } from './logger';
import type { RpcServerLike } from './types';

/**
 * Configuration for multi-endpoint Soroban RPC failover.
 *
 * The pool treats the first endpoint in the configured array as the primary and
 * the rest as ordered fallbacks. Failover happens transparently per RPC call:
 * if the currently-selected endpoint fails with a transient (network/5xx/rate
 * limit) error, the call is retried against the next healthy endpoint in order.
 */
export interface RpcFailoverOptions {
  /**
   * Optional factory used to build the underlying RPC server for each endpoint.
   * Defaults to `@stellar/stellar-sdk`'s `rpc.Server`. Primarily useful for
   * dependency injection and tests.
   */
  serverFactory?: (url: string) => RpcServerLike;
  /** Initial cooldown duration in ms after an endpoint trips (default: 5000). */
  cooldownMs?: number;
  /** Maximum cooldown duration in ms (default: 60000). */
  maxCooldownMs?: number;
  /** Consecutive transient failures required before an endpoint is cooled down (default: 3). */
  failureThreshold?: number;
  /** Initial EWMA latency estimate in ms used until real observations arrive (default: 200). */
  initialLatencyMs?: number;
  /** EWMA smoothing factor for latency/error scoring, 0 < alpha <= 1 (default: 0.2). */
  latencyAlpha?: number;
}

export interface EndpointHealth {
  url: string;
  score: number;
  latencyEwmaMs: number;
  errorEwma: number;
  consecutiveFailures: number;
  cooldownUntil: number;
  cooldownMs: number;
  attempts: number;
  transientFailures: number;
}

const DEFAULT_INITIAL_LATENCY_MS = 200;
const DEFAULT_ALPHA = 0.2;
const DEFAULT_COOLDOWN_MS = 5_000;
const DEFAULT_MAX_COOLDOWN_MS = 60_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
// Latency (ms) that maps to a 1.0 latency penalty in the health score.
const LATENCY_NORMALIZER_MS = 5_000;

type HealthRecord = {
  url: string;
  server: RpcServerLike;
  latencyEwmaMs: number;
  errorEwma: number;
  consecutiveFailures: number;
  cooldownUntil: number;
  cooldownMs: number;
  attempts: number;
  transientFailures: number;
};

/**
 * A transparent multi-endpoint Soroban RPC pool with health scoring.
 *
 * Implements {@link RpcServerLike} so it can be used anywhere a single RPC
 * server is expected. Requests prefer the healthiest endpoint in priority
 * order and fail over to the next endpoint only on transient errors. Semantic
 * errors (e.g. contract rejections, 4xx responses) propagate immediately and
 * never trigger failover, because they indicate the request reached a healthy
 * node.
 *
 * Health is tracked per endpoint with an EWMA of round-trip latency and an EWMA
 * of transient error rate. After `failureThreshold` consecutive transient
 * failures an endpoint is cooled down for a (doubling, capped) duration and is
 * skipped while cooled down. If every endpoint is cooled down the pool
 * fail-opens and uses the least-bad endpoint so availability is preserved.
 *
 * @example
 * ```ts
 * const pool = new RpcEndpointPool([
 *   'https://primary.soroban.example',
 *   'https://secondary.soroban.example',
 * ]);
 * const tx = await pool.prepareTransaction(transaction);
 * ```
 */
export class RpcEndpointPool implements RpcServerLike {
  private readonly records: HealthRecord[];
  private readonly initialLatencyMs: number;
  private readonly alpha: number;
  private readonly initialCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly failureThreshold: number;
  private readonly logger = createLogger('failover');

  constructor(endpoints: string[], options: RpcFailoverOptions = {}) {
    if (!endpoints.length) {
      throw new ValidationError(
        'RpcEndpointPool requires at least one RPC endpoint URL.',
        'Provide one or more Soroban RPC endpoint URLs ordered by priority.',
        undefined
      );
    }

    const factory = options.serverFactory ?? ((url: string) => new rpc.Server(url));
    this.initialCooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.maxCooldownMs = options.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS;
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.initialLatencyMs = options.initialLatencyMs ?? DEFAULT_INITIAL_LATENCY_MS;
    this.alpha = options.latencyAlpha ?? DEFAULT_ALPHA;

    const seen = new Set<string>();
    this.records = [];
    for (const rawUrl of endpoints) {
      const url = rawUrl.replace(/\/+$/, '');
      if (!url || seen.has(url)) continue;
      seen.add(url);
      this.records.push({
        url,
        server: factory(url),
        latencyEwmaMs: this.initialLatencyMs,
        errorEwma: 0,
        consecutiveFailures: 0,
        cooldownUntil: 0,
        cooldownMs: this.initialCooldownMs,
        attempts: 0,
        transientFailures: 0,
      });
    }

    if (!this.records.length) {
      throw new ValidationError(
        'RpcEndpointPool requires at least one RPC endpoint URL.',
        'Provide one or more Soroban RPC endpoint URLs ordered by priority.'
      );
    }
  }

  async getAccount(address: string): Promise<unknown> {
    return this.call((server) => server.getAccount(address));
  }

  async simulateTransaction(transaction: unknown): Promise<unknown> {
    return this.call((server) => server.simulateTransaction(transaction));
  }

  async prepareTransaction(transaction: unknown): Promise<{ toXDR(): string }> {
    return this.call((server) => server.prepareTransaction(transaction));
  }

  async sendTransaction(transaction: unknown): Promise<unknown> {
    return this.call((server) => server.sendTransaction(transaction));
  }

  async pollTransaction(hash: string, options?: { attempts?: number }): Promise<unknown> {
    return this.call((server) => server.pollTransaction(hash, options));
  }

  async getLatestLedger(): Promise<unknown> {
    return this.call((server) =>
      server.getLatestLedger
        ? server.getLatestLedger()
        : Promise.reject(new Error('RPC server does not support getLatestLedger'))
    );
  }

  /**
   * URL of the currently preferred (first non-cooled-down, priority-ordered)
   * endpoint. Used to pick the SSE event-stream URL; the stream itself is
   * long-lived and is not re-bound on primary rotation.
   */
  getRecommendedUrl(): string {
    return this.records[this.orderedEndpoints()[0]].url;
  }

  /** Snapshot of per-endpoint health records for observability. */
  getHealth(): EndpointHealth[] {
    return this.records.map((r) => ({
      url: r.url,
      score: this.score(r),
      latencyEwmaMs: r.latencyEwmaMs,
      errorEwma: r.errorEwma,
      consecutiveFailures: r.consecutiveFailures,
      cooldownUntil: r.cooldownUntil,
      cooldownMs: r.cooldownMs,
      attempts: r.attempts,
      transientFailures: r.transientFailures,
    }));
  }

  private call<T>(invoke: (server: RpcServerLike) => Promise<T>): Promise<T> {
    return this.tryEndpoints(invoke);
  }

  private async tryEndpoints<T>(invoke: (server: RpcServerLike) => Promise<T>): Promise<T> {
    const order = this.orderedEndpoints();
    let lastError: unknown;
    let attempted = false;

    for (const index of order) {
      const record = this.records[index];
      const startedAt = Date.now();
      attempted = true;

      try {
        const result = await invoke(record.server);
        this.recordSuccess(record, Date.now() - startedAt);
        return result;
      } catch (error) {
        if (!isTransientError(error)) {
          // The request reached a healthy node and produced an application-level
          // error. Treat as a reachability signal (no failover) and propagate.
          this.recordSuccess(record, Date.now() - startedAt);
          throw error;
        }
        lastError = error;
        this.recordTransientFailure(record);
        if (this.logger.enabled) {
          this.logger(`Endpoint failed (${record.url}), trying next endpoint`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    throw lastError;
  }

  /** Endpoint indices to attempt, in priority order, skipping cooled-down ones. */
  private orderedEndpoints(): number[] {
    const now = Date.now();
    const warm: number[] = [];
    const cooledDown: number[] = [];

    this.records.forEach((_, index) => {
      if (this.records[index].cooldownUntil > now) {
        cooledDown.push(index);
      } else {
        warm.push(index);
      }
    });

    // Fail open: if everything is cooled down, still attempt the least-bad endpoint.
    return warm.length > 0 ? warm : cooledDown;
  }

  private score(record: HealthRecord): number {
    const errorPenalty = Math.min(1, record.errorEwma) * 2;
    const latencyPenalty = Math.min(1, record.latencyEwmaMs / LATENCY_NORMALIZER_MS);
    return errorPenalty + latencyPenalty;
  }

  private recordSuccess(record: HealthRecord, latencyMs: number): void {
    record.attempts += 1;
    record.consecutiveFailures = 0;
    record.cooldownUntil = 0;
    record.cooldownMs = this.initialCooldownMs;
    const observed = Math.max(1, latencyMs);
    record.latencyEwmaMs = this.alpha * observed + (1 - this.alpha) * record.latencyEwmaMs;
    record.errorEwma *= 1 - this.alpha;
  }

  private recordTransientFailure(record: HealthRecord): void {
    record.attempts += 1;
    record.transientFailures += 1;
    record.consecutiveFailures += 1;
    record.errorEwma = this.alpha + (1 - this.alpha) * record.errorEwma;

    if (record.consecutiveFailures >= this.failureThreshold && record.cooldownUntil <= Date.now()) {
      record.cooldownUntil = Date.now() + record.cooldownMs;
      if (this.logger.enabled) {
        this.logger(`Endpoint cooled down for ${record.cooldownMs}ms (${record.url})`, {
          consecutiveFailures: record.consecutiveFailures,
        });
      }
      if (record.cooldownMs < this.maxCooldownMs) {
        record.cooldownMs = Math.min(record.cooldownMs * 2, this.maxCooldownMs);
      }
    }
  }
}