import { isTransientError } from './backoff';
import { RpcCircuitOpenError } from './errors';
import { TimeoutError } from './timeouts';

/**
 * Failure-rate circuit breaker for Soroban RPC calls.
 *
 * Distinct from the consecutive-failure `CircuitBreaker` in recovery.ts, which
 * is a general-purpose utility consumers wrap around their own operations.
 * This one is wired into every RPC call by rpc-resilience.ts and evaluates a
 * failure *ratio* over a sliding window, so a node that fails one call in ten
 * under load does not trip it while a node failing half its calls does.
 *
 * Tracks call outcomes over a sliding window. Once at least `minimumCalls`
 * have been observed and the failure rate reaches `failureRateThreshold`, the
 * circuit opens and every call fails fast with {@link RpcCircuitOpenError} for
 * `openDurationMs`. After that a limited number of trial calls are let through
 * (half-open); one success closes the circuit, one failure re-opens it.
 *
 * Only transient failures (network errors, 429/5xx, timeouts) count against the
 * circuit. Contract and validation errors are the caller's problem, not the
 * node's, so they neither trip nor heal the breaker.
 */
export type RpcCircuitState = 'closed' | 'open' | 'half-open';

export interface RpcCircuitBreakerOptions {
  /** Failure ratio (0–1) over the window that opens the circuit (default: 0.5). */
  failureRateThreshold?: number;
  /** Calls that must be observed in the window before the ratio is evaluated (default: 10). */
  minimumCalls?: number;
  /** Sliding window length in milliseconds (default: 60_000). */
  windowMs?: number;
  /** How long the circuit stays open before allowing trial calls (default: 30_000). */
  openDurationMs?: number;
  /** Trial calls allowed in flight while half-open (default: 1). */
  halfOpenMaxCalls?: number;
  /** Decides whether an error counts as a failure. Defaults to transient errors and timeouts. */
  isFailure?: (error: unknown) => boolean;
  /** Invoked on every state transition. */
  onStateChange?: (
    from: RpcCircuitState,
    to: RpcCircuitState,
    snapshot: RpcCircuitBreakerSnapshot
  ) => void;
  /** Clock override for tests. */
  now?: () => number;
}

export interface RpcCircuitBreakerSnapshot {
  state: RpcCircuitState;
  /** Calls observed in the current window. */
  calls: number;
  failures: number;
  /** failures / calls, or 0 when no calls were observed. */
  failureRate: number;
  /** Milliseconds until trial calls are allowed again; 0 unless the circuit is open. */
  retryAfterMs: number;
}

/** Defaults suitable for a public mainnet RPC endpoint. */
export const DEFAULT_RPC_CIRCUIT_BREAKER_OPTIONS: Required<
  Omit<RpcCircuitBreakerOptions, 'isFailure' | 'onStateChange' | 'now'>
> = {
  failureRateThreshold: 0.5,
  minimumCalls: 10,
  windowMs: 60_000,
  openDurationMs: 30_000,
  halfOpenMaxCalls: 1,
};

export function isCircuitFailure(error: unknown): boolean {
  return error instanceof TimeoutError || isTransientError(error);
}

interface Outcome {
  at: number;
  failed: boolean;
}

export class RpcCircuitBreaker {
  private readonly options: typeof DEFAULT_RPC_CIRCUIT_BREAKER_OPTIONS;
  private readonly isFailure: (error: unknown) => boolean;
  private readonly onStateChange?: RpcCircuitBreakerOptions['onStateChange'];
  private readonly now: () => number;
  private currentState: RpcCircuitState = 'closed';
  private outcomes: Outcome[] = [];
  private openedAt = 0;
  private halfOpenInFlight = 0;

  constructor(options: RpcCircuitBreakerOptions = {}) {
    this.options = {
      failureRateThreshold:
        options.failureRateThreshold ?? DEFAULT_RPC_CIRCUIT_BREAKER_OPTIONS.failureRateThreshold,
      minimumCalls: options.minimumCalls ?? DEFAULT_RPC_CIRCUIT_BREAKER_OPTIONS.minimumCalls,
      windowMs: options.windowMs ?? DEFAULT_RPC_CIRCUIT_BREAKER_OPTIONS.windowMs,
      openDurationMs: options.openDurationMs ?? DEFAULT_RPC_CIRCUIT_BREAKER_OPTIONS.openDurationMs,
      halfOpenMaxCalls:
        options.halfOpenMaxCalls ?? DEFAULT_RPC_CIRCUIT_BREAKER_OPTIONS.halfOpenMaxCalls,
    };
    if (this.options.failureRateThreshold <= 0 || this.options.failureRateThreshold > 1) {
      throw new RangeError('failureRateThreshold must be within (0, 1].');
    }
    if (this.options.minimumCalls < 1 || this.options.halfOpenMaxCalls < 1) {
      throw new RangeError('minimumCalls and halfOpenMaxCalls must be at least 1.');
    }
    this.isFailure = options.isFailure ?? isCircuitFailure;
    this.onStateChange = options.onStateChange;
    this.now = options.now ?? Date.now;
  }

  get state(): RpcCircuitState {
    this.maybeTransitionToHalfOpen();
    return this.currentState;
  }

  snapshot(): RpcCircuitBreakerSnapshot {
    this.maybeTransitionToHalfOpen();
    this.pruneWindow();
    const calls = this.outcomes.length;
    const failures = this.outcomes.filter((outcome) => outcome.failed).length;
    return {
      state: this.currentState,
      calls,
      failures,
      failureRate: calls === 0 ? 0 : failures / calls,
      retryAfterMs:
        this.currentState === 'open'
          ? Math.max(0, this.openedAt + this.options.openDurationMs - this.now())
          : 0,
    };
  }

  /**
   * Runs `fn` through the breaker. Throws {@link RpcCircuitOpenError} without
   * calling `fn` while the circuit is open (or half-open and saturated).
   */
  async execute<T>(fn: () => Promise<T>, operation = 'rpc'): Promise<T> {
    this.admit(operation);
    const halfOpenTrial = this.currentState === 'half-open';
    if (halfOpenTrial) this.halfOpenInFlight += 1;
    try {
      const result = await fn();
      this.record(false);
      return result;
    } catch (error) {
      if (this.isFailure(error)) {
        this.record(true);
      }
      throw error;
    } finally {
      if (halfOpenTrial) this.halfOpenInFlight -= 1;
    }
  }

  /** Forces the circuit closed and clears the window. */
  reset(): void {
    this.outcomes = [];
    this.halfOpenInFlight = 0;
    this.transition('closed');
  }

  private admit(operation: string): void {
    this.maybeTransitionToHalfOpen();
    if (this.currentState === 'open') {
      throw new RpcCircuitOpenError(operation, this.snapshot());
    }
    if (
      this.currentState === 'half-open' &&
      this.halfOpenInFlight >= this.options.halfOpenMaxCalls
    ) {
      throw new RpcCircuitOpenError(operation, this.snapshot());
    }
  }

  private record(failed: boolean): void {
    if (this.currentState === 'half-open') {
      if (failed) {
        this.open();
      } else {
        this.outcomes = [];
        this.transition('closed');
      }
      return;
    }
    if (this.currentState === 'open') return;

    this.outcomes.push({ at: this.now(), failed });
    this.pruneWindow();
    const calls = this.outcomes.length;
    if (calls < this.options.minimumCalls) return;
    const failures = this.outcomes.filter((outcome) => outcome.failed).length;
    if (failures / calls >= this.options.failureRateThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.openedAt = this.now();
    this.halfOpenInFlight = 0;
    this.transition('open');
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.currentState === 'open' && this.now() - this.openedAt >= this.options.openDurationMs) {
      this.halfOpenInFlight = 0;
      this.transition('half-open');
    }
  }

  private pruneWindow(): void {
    const cutoff = this.now() - this.options.windowMs;
    this.outcomes = this.outcomes.filter((outcome) => outcome.at > cutoff);
  }

  private transition(to: RpcCircuitState): void {
    const from = this.currentState;
    if (from === to) return;
    this.currentState = to;
    this.onStateChange?.(from, to, this.snapshot());
  }
}
