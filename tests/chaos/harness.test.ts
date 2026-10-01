import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluate, type Sample } from './probes';
import { REPORT_MARKER, renderMarkdown } from './report';
import { runScenario, runSuite, type RunnerDeps } from './runner';
import {
  PROBE_NAMES,
  PROXY_NAMES,
  SCENARIOS,
  validateScenarios,
  type ProbeName,
  type Scenario,
} from './scenarios';
import { ToxiproxyClient, type Proxy } from './toxiproxy-client';

/**
 * Deterministic unit tests for the chaos harness: a fake Toxiproxy API and
 * fake probes, no containers. The live suite is tests/chaos/suite.test.ts.
 */

/** In-memory Toxiproxy that records every mutation. */
function fakeToxiproxy() {
  const proxies: Record<string, Proxy> = Object.fromEntries(
    PROXY_NAMES.map((name) => [
      name,
      { name, listen: '0.0.0.0:1', upstream: 'x:1', enabled: true, toxics: [] },
    ])
  );
  const calls: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const url = req.url ?? '/';
      calls.push(`${req.method} ${url}`);
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(payload === undefined ? '' : JSON.stringify(payload));
      };
      if (url === '/version') return json(200, '2.9.0');
      if (url === '/reset' && req.method === 'POST') {
        for (const p of Object.values(proxies)) {
          p.enabled = true;
          p.toxics = [];
        }
        return json(204, undefined);
      }
      if (url === '/proxies' && req.method === 'GET') return json(200, proxies);
      const m = url.match(/^\/proxies\/([^/]+)(?:\/toxics(?:\/([^/]+))?)?$/);
      if (!m || !proxies[m[1]]) return json(404, { error: 'proxy not found' });
      const proxy = proxies[m[1]];
      if (m[2]) {
        if (req.method === 'DELETE') {
          proxy.toxics = proxy.toxics?.filter((t) => t.name !== m[2]);
          return json(204, undefined);
        }
        return json(405, {});
      }
      if (url.endsWith('/toxics')) {
        if (req.method === 'POST') {
          const toxic = JSON.parse(body);
          proxy.toxics?.push(toxic);
          return json(200, toxic);
        }
        return json(200, proxy.toxics);
      }
      if (req.method === 'POST') {
        Object.assign(proxy, JSON.parse(body));
        return json(200, proxy);
      }
      return json(200, proxy);
    });
  });
  return { server, proxies, calls };
}

describe('scenario catalogue', () => {
  it('every shipped scenario is structurally valid', () => {
    expect(validateScenarios(SCENARIOS)).toEqual([]);
    expect(SCENARIOS.map((s) => s.name)).toEqual([
      'indexer-partition',
      'indexer-latency-2s',
      'indexer-connection-resets',
      'rpc-outage-indexer',
      'rpc-latency-notifications',
    ]);
  });

  it('rejects scenarios that reference unknown proxies or probes, or lack recovery checks', () => {
    const bad: Scenario = {
      name: 'x',
      description: '',
      fault: { proxy: 'nope' as never, kind: 'toxics' },
      durationMs: 1,
      sampleIntervalMs: 5,
      recoveryTimeoutMs: 1,
      expectations: [
        { probe: 'ghost' as ProbeName, phase: 'during', minPassRatio: 2, check: { kind: 'no5xx' } },
      ],
    };
    const problems = validateScenarios([bad, bad]);
    expect(problems).toEqual(
      expect.arrayContaining([
        'x: duplicate name',
        'x: unknown proxy nope',
        'x: toxics fault without toxics',
        'x: durationMs must be between 10s and 10m',
        'x: sampleIntervalMs must be within the duration',
        'x: unknown probe ghost',
        'x: minPassRatio out of range',
        'x: no recovery expectation',
      ])
    );
  });
});

describe('expectation evaluation', () => {
  const sample = (over: Partial<Sample>): Sample => ({
    probe: 'oracleHealth',
    at: 0,
    status: 200,
    latencyMs: 100,
    body: { status: 'ok', nested: { db: 'ok' } },
    ...over,
  });
  it('evaluates every check kind', () => {
    expect(evaluate({ kind: 'status', anyOf: [200] }, sample({}))).toBe(true);
    expect(evaluate({ kind: 'status', anyOf: [200] }, sample({ status: 503 }))).toBe(false);
    expect(
      evaluate({ kind: 'status', anyOf: [200] }, sample({ status: null, error: 'ECONNREFUSED' }))
    ).toBe(false);
    expect(evaluate({ kind: 'no5xx' }, sample({ status: 404 }))).toBe(true);
    expect(evaluate({ kind: 'no5xx' }, sample({ status: 502 }))).toBe(false);
    expect(evaluate({ kind: 'no5xx' }, sample({ status: null }))).toBe(false);
    expect(evaluate({ kind: 'latencyBelowMs', ms: 150 }, sample({}))).toBe(true);
    expect(evaluate({ kind: 'latencyBelowMs', ms: 50 }, sample({}))).toBe(false);
    expect(
      evaluate({ kind: 'jsonField', path: 'status', anyOf: ['ok', 'degraded'] }, sample({}))
    ).toBe(true);
    expect(evaluate({ kind: 'jsonField', path: 'nested.db', anyOf: ['ok'] }, sample({}))).toBe(
      true
    );
    expect(
      evaluate({ kind: 'jsonField', path: 'nested.db', anyOf: ['ok'] }, sample({ body: 'text' }))
    ).toBe(false);
  });
});

describe('Toxiproxy client against a fake API', () => {
  const fake = fakeToxiproxy();
  let client: ToxiproxyClient;
  beforeAll(async () => {
    await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    const port = (fake.server.address() as { port: number }).port;
    client = new ToxiproxyClient(`http://127.0.0.1:${port}`);
  });
  afterAll(() => fake.server.close());

  it('lists, disables, enables, adds and removes toxics, and resets', async () => {
    expect(await client.version()).toContain('2.9.0');
    expect(Object.keys(await client.listProxies())).toEqual(PROXY_NAMES);
    expect((await client.disable('indexer-upstream')).enabled).toBe(false);
    expect((await client.enable('indexer-upstream')).enabled).toBe(true);
    await client.addToxic('rpc-indexer', {
      name: 'lat',
      type: 'latency',
      attributes: { latency: 100 },
    });
    expect(await client.listToxics('rpc-indexer')).toEqual([
      expect.objectContaining({ name: 'lat', type: 'latency', stream: 'downstream', toxicity: 1 }),
    ]);
    await client.removeToxic('rpc-indexer', 'lat');
    expect(await client.listToxics('rpc-indexer')).toEqual([]);
    await client.disable('rpc-notifications');
    await client.reset();
    expect((await client.getProxy('rpc-notifications')).enabled).toBe(true);
    await expect(client.getProxy('missing')).rejects.toThrow(/404/);
  });
});

describe('runner', () => {
  function deps(
    overrides: Partial<RunnerDeps> & {
      samplesFor: (probe: ProbeName, phase: 'during' | 'recovery', tick: number) => Partial<Sample>;
    }
  ): RunnerDeps & { calls: string[]; clock: { t: number } } {
    const calls: string[] = [];
    const clock = { t: 0 };
    let faulted = false;
    let tick = 0;
    const probe = (name: ProbeName) => async (): Promise<Sample> => {
      tick += 1;
      return {
        probe: name,
        at: clock.t,
        status: 200,
        latencyMs: 10,
        body: {},
        ...overrides.samplesFor(name, faulted ? 'during' : 'recovery', tick),
      };
    };
    return {
      calls,
      clock,
      toxiproxy: {
        disable: async (p) => {
          calls.push(`disable ${p}`);
          faulted = true;
          return {} as Proxy;
        },
        enable: async (p) => {
          calls.push(`enable ${p}`);
          faulted = false;
          return {} as Proxy;
        },
        addToxic: async (p, t) => {
          calls.push(`addToxic ${p} ${t.name}`);
          faulted = true;
          return t;
        },
        removeToxic: async (p, n) => {
          calls.push(`removeToxic ${p} ${n}`);
          faulted = false;
        },
        reset: async () => {
          calls.push('reset');
        },
      },
      probes: Object.fromEntries(PROBE_NAMES.map((n) => [n, probe(n)])) as Record<
        ProbeName,
        () => Promise<Sample>
      >,
      sleep: async (ms) => {
        clock.t += ms;
      },
      now: () => clock.t,
      timeScale: 1,
      ...overrides,
    };
  }

  it('injects, samples, heals and reports recovery time for a passing scenario', async () => {
    const d = deps({
      samplesFor: (probe, phase) =>
        probe === 'oracleHealth'
          ? { body: { status: phase === 'during' ? 'degraded' : 'ok' } }
          : {},
    });
    const result = await runScenario(SCENARIOS[0], d);
    expect(result.ok).toBe(true);
    expect(d.calls).toEqual(['disable indexer-upstream', 'enable indexer-upstream']);
    expect(result.recoveredAfterMs).toBe(0);
    expect(result.expectations.every((e) => e.ok)).toBe(true);
    expect(result.expectations.find((e) => e.expectation.phase === 'during')?.samples).toBe(
      SCENARIOS[0].durationMs / SCENARIOS[0].sampleIntervalMs
    );
  });

  it('fails a scenario whose service returns 5xx during the fault, but still heals', async () => {
    const d = deps({
      samplesFor: (probe, phase) =>
        probe === 'oracleVerify' && phase === 'during'
          ? { status: 502 }
          : { body: { status: 'ok' } },
    });
    const result = await runScenario(SCENARIOS[0], d);
    expect(result.ok).toBe(false);
    expect(d.calls).toContain('enable indexer-upstream');
    const failing = result.expectations.filter((e) => !e.ok).map((e) => e.expectation.check.kind);
    expect(failing).toEqual(['no5xx']);
  });

  it('fails when the service never recovers within the timeout', async () => {
    const d = deps({ samplesFor: () => ({ body: { status: 'degraded' } }) });
    const result = await runScenario(SCENARIOS[0], d);
    expect(result.ok).toBe(false);
    expect(result.recoveredAfterMs).toBeNull();
    expect(d.clock.t).toBeGreaterThan(SCENARIOS[0].durationMs + SCENARIOS[0].recoveryTimeoutMs);
  });

  it('honours minPassRatio for flaky-but-acceptable samples', async () => {
    let n = 0;
    const d = deps({
      samplesFor: (probe, phase) =>
        probe === 'oracleVerify' && phase === 'during'
          ? { latencyMs: ++n % 10 === 0 ? 9_000 : 100 }
          : { body: { status: 'ok' } },
    });
    const result = await runScenario(SCENARIOS[0], d);
    const latency = result.expectations.find((e) => e.expectation.check.kind === 'latencyBelowMs')!;
    expect(latency.passRatio).toBeGreaterThanOrEqual(0.9);
    expect(latency.ok).toBe(true);
  });

  it('heals the link even when a probe throws, and resets Toxiproxy at the end of the suite', async () => {
    const d = deps({ samplesFor: () => ({}) });
    d.probes = {
      ...d.probes,
      oracleHealth: async () => {
        throw new Error('probe exploded');
      },
    };
    const results = await runSuite([SCENARIOS[0]], d);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('probe exploded');
    expect(d.calls.slice(-2)).toEqual(['enable indexer-upstream', 'reset']);
  });

  it('applies and removes every toxic for toxic-based faults', async () => {
    const d = deps({ samplesFor: () => ({ body: { status: 'ok' }, latencyMs: 50 }) });
    const result = await runScenario(SCENARIOS[2], d);
    expect(result.ok).toBe(true);
    expect(d.calls).toEqual([
      'addToxic indexer-upstream reset',
      'addToxic indexer-upstream slice',
      'removeToxic indexer-upstream reset',
      'removeToxic indexer-upstream slice',
    ]);
  });

  it('refuses to run an invalid catalogue', async () => {
    const d = deps({ samplesFor: () => ({}) });
    await expect(runSuite([{ ...SCENARIOS[0], expectations: [] }], d)).rejects.toThrow(
      /no expectations/
    );
  });
});

describe('report', () => {
  it('renders a markdown table with failures explained', async () => {
    const d = { samplesFor: () => ({ status: 503 }) };
    const calls: string[] = [];
    const result = await runScenario(SCENARIOS[3], {
      toxiproxy: {
        disable: async () => ({} as Proxy),
        enable: async () => ({} as Proxy),
        addToxic: async (_p, t) => t,
        removeToxic: async () => undefined,
        reset: async () => undefined,
      },
      probes: Object.fromEntries(
        PROBE_NAMES.map((n) => [
          n,
          async () => ({ probe: n, at: 0, latencyMs: 1, body: {}, ...d.samplesFor() }),
        ])
      ) as never,
      sleep: async () => undefined,
      now: (() => {
        let t = 0;
        return () => (t += 1_000);
      })(),
      log: (l) => calls.push(l),
    });
    const md = renderMarkdown([result]);
    expect(md.startsWith(REPORT_MARKER)).toBe(true);
    expect(md).toContain('**0/1 scenarios passed.**');
    expect(md).toContain('| rpc-outage-indexer | FAIL | not recovered |');
    expect(md).toContain('indexerHealth db in [ok] (during, ≥100%)');
    expect(calls.some((l) => l.includes('FAIL'))).toBe(true);
  });
});
