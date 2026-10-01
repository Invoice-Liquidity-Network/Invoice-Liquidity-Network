import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RpcCircuitBreaker } from './circuit-breaker';
import { RpcCircuitOpenError, ValidationError } from './errors';
import {
  MAINNET_CIRCUIT_BREAKER,
  MAINNET_RPC_BACKOFF,
  createResilientRpcServer,
  getRpcResilience,
  isPreflightFailure,
  isRetryableRpcFailure,
} from './rpc-resilience';
import { TimeoutError } from './timeouts';

/** Fault-injection RPC server: each method replays a scripted list of outcomes. */
type Outcome = { ok: unknown } | { error: unknown } | { hangMs: number; then?: unknown };

function scriptedServer(script: Record<string, Outcome[]>) {
  const calls: Record<string, number> = {};
  const server: Record<string, (...args: unknown[]) => Promise<unknown>> & {
    plain?: () => string;
  } = {};
  for (const [method, outcomes] of Object.entries(script)) {
    server[method] = vi.fn(async () => {
      calls[method] = (calls[method] ?? 0) + 1;
      const outcome = outcomes.shift() ?? { ok: 'default' };
      if ('hangMs' in outcome) {
        await new Promise((resolve) => setTimeout(resolve, outcome.hangMs));
        return outcome.then ?? 'late';
      }
      if ('error' in outcome) throw outcome.error;
      return outcome.ok;
    });
  }
  server.plain = function plain(this: unknown) {
    return this === server ? 'bound' : 'unbound';
  };
  return { server, calls };
}

const reset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
const rateLimited = () => Object.assign(new Error('Too Many Requests'), { status: 429 });
const refused = () =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8000'), { code: 'ECONNREFUSED' });

describe('createResilientRpcServer (issue: SDK RPC retry + circuit breaker)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter midpoint → deterministic delays
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a fresh request per attempt and succeeds after transient failures', async () => {
    const { server, calls } = scriptedServer({
      simulateTransaction: [{ error: reset() }, { error: rateLimited() }, { ok: 'sim-ok' }],
    });
    const retries: number[] = [];
    const resilient = createResilientRpcServer(server, {
      backoff: { baseDelayMs: 100, jitter: 0, onRetry: (attempt) => retries.push(attempt) },
    });
    const pending = resilient.simulateTransaction('tx');
    await vi.advanceTimersByTimeAsync(100); // after 1st failure
    await vi.advanceTimersByTimeAsync(200); // after 2nd failure (doubled)
    await expect(pending).resolves.toBe('sim-ok');
    expect(calls.simulateTransaction).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it('gives up after maxRetries and surfaces the last error', async () => {
    const { server, calls } = scriptedServer({
      getAccount: [{ error: reset() }, { error: reset() }, { error: reset() }],
    });
    const resilient = createResilientRpcServer(server, {
      backoff: { maxRetries: 2, baseDelayMs: 10, jitter: 0 },
    });
    const pending = resilient.getAccount('G...');
    const settled = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(10 + 20);
    await expect(settled).resolves.toMatchObject({ code: 'ECONNRESET' });
    expect(calls.getAccount).toBe(3);
  });

  it('applies exponential backoff with jitter inside the configured bounds', async () => {
    Math.random = vi.fn().mockReturnValue(1); // upper edge of the jitter range
    const { server } = scriptedServer({
      getLatestLedger: [{ error: reset() }, { error: reset() }, { ok: 1 }],
    });
    const delays: number[] = [];
    const resilient = createResilientRpcServer(server, {
      backoff: {
        baseDelayMs: 100,
        multiplier: 2,
        jitter: 0.25,
        onRetry: (_a, _e, d) => delays.push(d),
      },
    });
    const pending = resilient.getLatestLedger();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toBe(1);
    expect(delays).toEqual([125, 250]); // 100 ± 25% → 125 at the upper edge, then 200 ± 25% → 250
  });

  it('treats a per-attempt timeout as a deadline: surfaces TimeoutError without retrying by default', async () => {
    const { server, calls } = scriptedServer({
      getAccount: [{ hangMs: 60_000 }, { ok: 'account' }],
    });
    const resilient = createResilientRpcServer(server, {
      timeouts: { readMs: 1_000 },
      backoff: { baseDelayMs: 10, jitter: 0 },
    });
    const pending = resilient.getAccount('G...').catch((e) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending;
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toMatchObject({ operation: 'getAccount', timeoutMs: 1_000 });
    expect(calls.getAccount).toBe(1);
  });

  it('retries idempotent reads after a timeout when retryTimeouts is enabled', async () => {
    const { server, calls } = scriptedServer({
      getAccount: [{ hangMs: 60_000 }, { ok: 'account' }],
    });
    const resilient = createResilientRpcServer(server, {
      timeouts: { readMs: 1_000 },
      retryTimeouts: true,
      backoff: { baseDelayMs: 10, jitter: 0 },
    });
    const pending = resilient.getAccount('G...');
    await vi.advanceTimersByTimeAsync(1_000 + 10);
    await expect(pending).resolves.toBe('account');
    expect(calls.getAccount).toBe(2);
  });

  it('counts timeouts against the breaker so a hung node trips it', async () => {
    const { server, calls } = scriptedServer({
      getAccount: [{ hangMs: 60_000 }, { hangMs: 60_000 }, { ok: 'x' }],
    });
    const resilient = createResilientRpcServer(server, {
      timeouts: { readMs: 100 },
      backoff: false,
      circuitBreaker: { minimumCalls: 2, failureRateThreshold: 0.5 },
    });
    const first = resilient.getAccount('G').catch((e) => e);
    const second = resilient.getAccount('G').catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toBeInstanceOf(TimeoutError);
    expect(await second).toBeInstanceOf(TimeoutError);
    await expect(resilient.getAccount('G')).rejects.toBeInstanceOf(RpcCircuitOpenError);
    expect(calls.getAccount).toBe(2);
  });

  it('invoke() applies the policy with a caller-supplied label and timeout', async () => {
    const { server, calls } = scriptedServer({
      simulateTransaction: [{ error: reset() }, { hangMs: 60_000 }],
    });
    const resilient = createResilientRpcServer(server, { backoff: { baseDelayMs: 1, jitter: 0 } });
    const handle = getRpcResilience(resilient)!;
    const pending = handle
      .invoke('simulateTransaction', ['tx'], {
        operation: 'simulateTransaction:get_invoice',
        timeoutMs: 50,
      })
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(1 + 50);
    const error = await pending;
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toMatchObject({ operation: 'simulateTransaction:get_invoice', timeoutMs: 50 });
    expect(calls.simulateTransaction).toBe(2); // ECONNRESET retried, then the hang hit the deadline
    await expect(handle.invoke('nope', [])).rejects.toBeInstanceOf(TypeError);
  });

  it('never retries sendTransaction after a timeout because the node may have accepted it', async () => {
    const { server, calls } = scriptedServer({
      sendTransaction: [{ hangMs: 60_000 }, { ok: 'unexpected' }],
    });
    const resilient = createResilientRpcServer(server, {
      timeouts: { writeMs: 500 },
      backoff: { baseDelayMs: 1 },
    });
    const pending = resilient.sendTransaction('signed').catch((e) => e);
    await vi.advanceTimersByTimeAsync(600);
    const error = await pending;
    expect(error).toBeInstanceOf(TimeoutError);
    expect(calls.sendTransaction).toBe(1);
  });

  it('retries sendTransaction only for pre-flight failures', async () => {
    const { server, calls } = scriptedServer({
      sendTransaction: [{ error: refused() }, { error: rateLimited() }, { ok: 'sent' }],
    });
    const resilient = createResilientRpcServer(server, { backoff: { baseDelayMs: 1, jitter: 0 } });
    const pending = resilient.sendTransaction('signed');
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBe('sent');
    expect(calls.sendTransaction).toBe(3);

    const mid = scriptedServer({ sendTransaction: [{ error: reset() }, { ok: 'nope' }] });
    const resilient2 = createResilientRpcServer(mid.server, { backoff: { baseDelayMs: 1 } });
    await expect(resilient2.sendTransaction('signed')).rejects.toMatchObject({
      code: 'ECONNRESET',
    });
    expect(mid.calls.sendTransaction).toBe(1);
  });

  it('does not retry ILN errors or validation failures', async () => {
    const { server, calls } = scriptedServer({
      simulateTransaction: [{ error: new ValidationError('bad') }, { ok: 'x' }],
    });
    const resilient = createResilientRpcServer(server, { backoff: { baseDelayMs: 1 } });
    await expect(resilient.simulateTransaction('tx')).rejects.toBeInstanceOf(ValidationError);
    expect(calls.simulateTransaction).toBe(1);
  });

  it('trips the breaker after a sustained failure rate and fails fast without retrying', async () => {
    const outcomes = Array.from({ length: 12 }, () => ({ error: reset() } as Outcome));
    const { server, calls } = scriptedServer({ getAccount: outcomes });
    const transitions: string[] = [];
    const resilient = createResilientRpcServer(server, {
      backoff: false,
      circuitBreaker: { minimumCalls: 4, failureRateThreshold: 0.5, openDurationMs: 30_000 },
      logger: (message) => transitions.push(message),
    });
    for (let i = 0; i < 4; i += 1) {
      await expect(resilient.getAccount('G')).rejects.toMatchObject({ code: 'ECONNRESET' });
    }
    expect(calls.getAccount).toBe(4);
    const fastFail = resilient.getAccount('G');
    await expect(fastFail).rejects.toBeInstanceOf(RpcCircuitOpenError);
    await expect(fastFail).rejects.toMatchObject({
      code: 'RPC_CIRCUIT_OPEN',
      retryAfterMs: 30_000,
    });
    expect(calls.getAccount).toBe(4); // nothing reached the node
    expect(transitions.some((line) => line.includes('closed → open'))).toBe(true);
    expect(getRpcResilience(resilient)?.breaker?.state).toBe('open');
  });

  it('stops a retry sequence as soon as the breaker opens', async () => {
    const { server, calls } = scriptedServer({
      getAccount: Array.from({ length: 10 }, () => ({ error: reset() } as Outcome)),
    });
    const resilient = createResilientRpcServer(server, {
      backoff: { maxRetries: 5, baseDelayMs: 1, jitter: 0 },
      circuitBreaker: { minimumCalls: 2, failureRateThreshold: 0.5 },
    });
    const pending = resilient.getAccount('G').catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeInstanceOf(RpcCircuitOpenError);
    expect(calls.getAccount).toBe(2); // two real attempts, then the open circuit ended the sequence
  });

  it('recovers through a half-open trial once the node is healthy again', async () => {
    const { server, calls } = scriptedServer({
      getAccount: [{ error: reset() }, { error: reset() }, { ok: 'back' }, { ok: 'again' }],
    });
    const resilient = createResilientRpcServer(server, {
      backoff: false,
      circuitBreaker: { minimumCalls: 2, openDurationMs: 5_000 },
    });
    await expect(resilient.getAccount('G')).rejects.toMatchObject({ code: 'ECONNRESET' });
    await expect(resilient.getAccount('G')).rejects.toMatchObject({ code: 'ECONNRESET' });
    await expect(resilient.getAccount('G')).rejects.toBeInstanceOf(RpcCircuitOpenError);
    vi.advanceTimersByTime(5_000);
    await expect(resilient.getAccount('G')).resolves.toBe('back');
    await expect(resilient.getAccount('G')).resolves.toBe('again');
    expect(calls.getAccount).toBe(4);
  });

  it('shares one breaker across clients when given an instance', async () => {
    const breaker = new RpcCircuitBreaker({ minimumCalls: 2 });
    const a = createResilientRpcServer(
      scriptedServer({ getAccount: [{ error: reset() }, { error: reset() }] }).server,
      {
        backoff: false,
        circuitBreaker: breaker,
      }
    );
    const b = createResilientRpcServer(scriptedServer({ getAccount: [{ ok: 'x' }] }).server, {
      backoff: false,
      circuitBreaker: breaker,
    });
    await expect(a.getAccount('G')).rejects.toMatchObject({ code: 'ECONNRESET' });
    await expect(a.getAccount('G')).rejects.toMatchObject({ code: 'ECONNRESET' });
    await expect(b.getAccount('G')).rejects.toBeInstanceOf(RpcCircuitOpenError);
  });

  it('can disable retries and the breaker independently', async () => {
    const { server, calls } = scriptedServer({
      getAccount: Array.from({ length: 30 }, () => ({ error: reset() } as Outcome)),
    });
    const resilient = createResilientRpcServer(server, { backoff: false, circuitBreaker: false });
    for (let i = 0; i < 20; i += 1) {
      await expect(resilient.getAccount('G')).rejects.toMatchObject({ code: 'ECONNRESET' });
    }
    expect(calls.getAccount).toBe(20);
    expect(getRpcResilience(resilient)).toMatchObject({ breaker: null, backoff: false });
  });

  it('passes unknown members through with `this` bound and never double-wraps', () => {
    const { server } = scriptedServer({});
    const resilient = createResilientRpcServer(server);
    expect(resilient.plain?.()).toBe('bound');
    expect(createResilientRpcServer(resilient)).toBe(resilient);
    expect(getRpcResilience(resilient)?.timeouts).toEqual({
      readMs: 10_000,
      writeMs: 30_000,
      simulationMs: 15_000,
    });
    expect(getRpcResilience(resilient)?.backoff).toMatchObject(MAINNET_RPC_BACKOFF);
    expect(MAINNET_CIRCUIT_BREAKER).toMatchObject({ failureRateThreshold: 0.5, minimumCalls: 10 });
  });

  it('classifies failures per method', () => {
    expect(isPreflightFailure(refused())).toBe(true);
    expect(isPreflightFailure(rateLimited())).toBe(true);
    expect(isPreflightFailure(reset())).toBe(false);
    expect(isRetryableRpcFailure('getAccount', new TimeoutError('getAccount', 1))).toBe(false);
    expect(isRetryableRpcFailure('getAccount', new TimeoutError('getAccount', 1), true)).toBe(true);
    expect(
      isRetryableRpcFailure('sendTransaction', new TimeoutError('sendTransaction', 1), true)
    ).toBe(false);
    expect(isRetryableRpcFailure('sendTransaction', new TimeoutError('sendTransaction', 1))).toBe(
      false
    );
    expect(isRetryableRpcFailure('sendTransaction', reset())).toBe(false);
    expect(isRetryableRpcFailure('sendTransaction', refused())).toBe(true);
    expect(isRetryableRpcFailure('simulateTransaction', { status: 503 })).toBe(true);
    expect(isRetryableRpcFailure('simulateTransaction', new ValidationError('x'))).toBe(false);
  });
});
