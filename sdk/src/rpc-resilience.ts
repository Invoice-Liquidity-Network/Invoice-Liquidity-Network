import { withBackoff, isTransientError, type BackoffOptions } from './backoff';
import { RpcCircuitBreaker, type RpcCircuitBreakerOptions } from './circuit-breaker';
import { ILNError, RpcCircuitOpenError } from './errors';
import {
  resolveRequestTimeouts,
  TimeoutError,
  withTimeout,
  type RequestTimeouts,
} from './timeouts';

/**
 * Wraps a Soroban RPC server so every call gets a per-attempt timeout, retry
 * with exponential backoff and jitter, and a circuit breaker, without each
 * client having to remember to do so at every call site.
 *
 * Retries always re-invoke the underlying method (a fresh request per attempt).
 * Timeouts are deadlines: a hung attempt counts against the circuit breaker
 * and surfaces as `TimeoutError` without being retried unless `retryTimeouts`
 * is set, in which case only idempotent methods are retried. `sendTransaction`
 * is only ever retried when the request provably never reached the node
 * (connection refused, DNS failure, 429), because the transaction may already
 * have been accepted.
 */
export interface RpcResilienceOptions {
  /** Retry policy. `false` disables retries. Defaults to {@link MAINNET_RPC_BACKOFF}. */
  backoff?: BackoffOptions | false;
  /**
   * Circuit breaker. Pass options, an existing {@link RpcCircuitBreaker} to share
   * across clients, or `false` to disable. Defaults to a breaker with
   * {@link MAINNET_CIRCUIT_BREAKER} options.
   */
  circuitBreaker?: RpcCircuitBreakerOptions | RpcCircuitBreaker | false;
  /** Per-attempt timeouts, resolved the same way as `ILNSdkConfig.timeouts`. */
  timeouts?: Partial<RequestTimeouts>;
  /** Fallback timeout when `timeouts` does not specify a class. */
  timeoutMs?: number;
  /**
   * Retry idempotent methods whose attempt timed out (default: false). Off by
   * default because the per-attempt timeout is treated as the caller's
   * deadline; turn it on when timeouts are short relative to the deadline.
   */
  retryTimeouts?: boolean;
  /** Receives one line per retry and per breaker state change. */
  logger?: (message: string, context?: Record<string, unknown>) => void;
}

/** Per-call overrides for {@link RpcResilienceHandle.invoke}. */
export interface RpcInvokeContext {
  /** Label used in `TimeoutError` and breaker rejections (default: the method name). */
  operation?: string;
  /** Per-attempt timeout for this call (default: the method's timeout class). */
  timeoutMs?: number;
}

/** Retry defaults for a public mainnet RPC endpoint: 3 retries, 500ms → 10s, 25% jitter. */
export const MAINNET_RPC_BACKOFF: Required<Omit<BackoffOptions, 'isRetryable' | 'onRetry'>> = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  multiplier: 2,
  jitter: 0.25,
};

/** Breaker defaults: open after ≥50% transient failures across ≥10 calls in 60s, probe again after 30s. */
export const MAINNET_CIRCUIT_BREAKER: RpcCircuitBreakerOptions = {
  failureRateThreshold: 0.5,
  minimumCalls: 10,
  windowMs: 60_000,
  openDurationMs: 30_000,
  halfOpenMaxCalls: 1,
};

type TimeoutClass = keyof RequestTimeouts;

interface MethodPolicy {
  timeout: TimeoutClass;
  /** Whether a timed-out attempt may be retried. */
  retryOnTimeout: boolean;
  /** Submissions are only retried when the request never reached the node. */
  submit?: boolean;
}

const READ: MethodPolicy = { timeout: 'readMs', retryOnTimeout: true };
const WRITE: MethodPolicy = { timeout: 'writeMs', retryOnTimeout: true };

/** RPC methods the wrapper knows about; anything else passes through untouched. */
export const RPC_METHOD_POLICIES: Readonly<Record<string, MethodPolicy>> = {
  getAccount: READ,
  getLatestLedger: READ,
  getLedgerEntries: READ,
  getTransaction: READ,
  getTransactions: READ,
  getEvents: READ,
  getHealth: READ,
  getNetwork: READ,
  getFeeStats: READ,
  getVersionInfo: READ,
  simulateTransaction: { timeout: 'simulationMs', retryOnTimeout: true },
  prepareTransaction: WRITE,
  pollTransaction: WRITE,
  sendTransaction: { timeout: 'writeMs', retryOnTimeout: false, submit: true },
};

const PREFLIGHT_PATTERNS = [
  'econnrefused',
  'enotfound',
  'eai_again',
  'ehostunreach',
  'enetunreach',
];

/** True when the request demonstrably never reached the server. */
export function isPreflightFailure(error: unknown): boolean {
  if (!error) return false;
  const err = error as Record<string, unknown>;
  if (err.status === 429 || err.statusCode === 429) return true;
  const code = String(err.code ?? '').toLowerCase();
  if (PREFLIGHT_PATTERNS.includes(code)) return true;
  const message = String(err.message ?? '').toLowerCase();
  return PREFLIGHT_PATTERNS.some((pattern) => message.includes(pattern));
}

/** Decides whether an attempt of `method` that failed with `error` should be retried. */
export function isRetryableRpcFailure(
  method: string,
  error: unknown,
  retryTimeouts = false
): boolean {
  if (error instanceof RpcCircuitOpenError) return false;
  if (error instanceof ILNError) return false;
  const policy = RPC_METHOD_POLICIES[method];
  if (error instanceof TimeoutError) return retryTimeouts && (policy?.retryOnTimeout ?? false);
  if (policy?.submit) return isPreflightFailure(error);
  return isTransientError(error);
}

export interface RpcResilienceHandle {
  breaker: RpcCircuitBreaker | null;
  timeouts: RequestTimeouts;
  backoff: BackoffOptions | false;
  /**
   * Calls `method` on the underlying server with the full policy but a
   * caller-supplied operation label and timeout. Used by clients that label
   * timeouts per contract method (`simulateTransaction:get_invoice`).
   */
  invoke<T>(method: string, args: unknown[], context?: RpcInvokeContext): Promise<T>;
}

const HANDLE = Symbol.for('iln.sdk.rpcResilience');

/** Returns the resilience handle of a server created by {@link createResilientRpcServer}. */
export function getRpcResilience(server: object): RpcResilienceHandle | undefined {
  return (server as { [HANDLE]?: RpcResilienceHandle })[HANDLE];
}

export function resolveCircuitBreaker(
  option: RpcResilienceOptions['circuitBreaker'],
  logger?: RpcResilienceOptions['logger']
): RpcCircuitBreaker | null {
  if (option === false) return null;
  if (option instanceof RpcCircuitBreaker) return option;
  return new RpcCircuitBreaker({
    ...MAINNET_CIRCUIT_BREAKER,
    ...option,
    onStateChange: (from, to, snapshot) => {
      logger?.(`RPC circuit breaker ${from} → ${to}`, {
        failureRate: snapshot.failureRate,
        calls: snapshot.calls,
        retryAfterMs: snapshot.retryAfterMs,
      });
      option?.onStateChange?.(from, to, snapshot);
    },
  });
}

/**
 * Returns a proxy over `server` whose RPC methods run with timeout, retry and
 * circuit-breaker protection. Already-wrapped servers are returned as-is so
 * nesting clients never stacks policies.
 */
export function createResilientRpcServer<T extends object>(
  server: T,
  options: RpcResilienceOptions = {}
): T {
  if (getRpcResilience(server)) return server;

  const timeouts = resolveRequestTimeouts(options);
  const backoff: BackoffOptions | false =
    options.backoff === false ? false : { ...MAINNET_RPC_BACKOFF, ...options.backoff };
  const breaker = resolveCircuitBreaker(options.circuitBreaker, options.logger);
  const run = async (
    method: string,
    invoke: () => Promise<unknown>,
    context: RpcInvokeContext = {}
  ): Promise<unknown> => {
    const policy = RPC_METHOD_POLICIES[method];
    const operation = context.operation ?? method;
    const timeoutMs = context.timeoutMs ?? timeouts[policy.timeout];
    const attempt = (): Promise<unknown> => {
      const guarded = () => withTimeout(operation, timeoutMs, invoke());
      return breaker ? breaker.execute(guarded, operation) : guarded();
    };
    if (backoff === false) return attempt();
    const { result } = await withBackoff(attempt, {
      ...backoff,
      isRetryable: (error) => isRetryableRpcFailure(method, error, options.retryTimeouts ?? false),
      onRetry: (attemptNumber, error, delayMs) => {
        options.logger?.(
          `Retrying ${operation} (attempt ${attemptNumber}) after ${Math.round(delayMs)}ms`,
          { error: error instanceof Error ? error.message : String(error) }
        );
        backoff.onRetry?.(attemptNumber, error, delayMs);
      },
    });
    return result;
  };

  const handle: RpcResilienceHandle = {
    breaker,
    timeouts,
    backoff,
    invoke: <T>(method: string, args: unknown[], context?: RpcInvokeContext) => {
      const target = server as Record<string, unknown>;
      const fn = target[method];
      if (typeof fn !== 'function') {
        return Promise.reject(new TypeError(`RPC server does not implement ${method}.`));
      }
      if (!RPC_METHOD_POLICIES[method]) {
        return Promise.resolve(fn.apply(server, args) as T);
      }
      return run(method, () => fn.apply(server, args) as Promise<unknown>, context) as Promise<T>;
    },
  };

  const wrapped = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === HANDLE) return handle;
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (typeof prop !== 'string' || !RPC_METHOD_POLICIES[prop]) {
        return value.bind(target);
      }
      let fn = wrapped.get(prop);
      if (!fn) {
        fn = (...args: unknown[]) => run(prop, () => value.apply(target, args));
        wrapped.set(prop, fn);
      }
      return fn;
    },
  });
}
