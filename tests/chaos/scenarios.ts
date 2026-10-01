import type { Toxic } from './toxiproxy-client';

/**
 * Chaos scenarios. Each one injects a fault on one Toxiproxy link, samples the
 * probes while the fault is active, heals the link, then waits for recovery.
 * The expectations encode the resilience behaviour the services claim:
 * degrade, never crash, recover on their own.
 *
 * Add a scenario by appending to SCENARIOS; `harness.test.ts` validates that
 * every proxy, probe and expectation it references exists.
 */
export type ProbeName =
  | 'oracleHealth'
  | 'oracleVerify'
  | 'indexerHealth'
  | 'notificationsHealth'
  | 'notificationsProviders';

export type ProxyName = 'rpc-indexer' | 'indexer-upstream' | 'rpc-notifications';

export interface Fault {
  proxy: ProxyName;
  /** `partition` disables the proxy; `toxics` attaches Toxiproxy toxics. */
  kind: 'partition' | 'toxics';
  toxics?: Toxic[];
}

export interface Expectation {
  probe: ProbeName;
  /** Which phase the expectation applies to. */
  phase: 'during' | 'recovery';
  /** Minimum share of samples that must satisfy the check (0–1). */
  minPassRatio: number;
  check: ExpectationCheck;
}

export type ExpectationCheck =
  | { kind: 'status'; anyOf: number[] }
  | { kind: 'latencyBelowMs'; ms: number }
  | { kind: 'jsonField'; path: string; anyOf: unknown[] }
  | { kind: 'no5xx' };

export interface Scenario {
  name: string;
  description: string;
  fault: Fault;
  /** How long the fault stays active. */
  durationMs: number;
  /** Probe sampling interval while the fault is active. */
  sampleIntervalMs: number;
  /** How long recovery may take after healing before the scenario fails. */
  recoveryTimeoutMs: number;
  expectations: Expectation[];
}

const during = (probe: ProbeName, check: ExpectationCheck, minPassRatio = 1): Expectation => ({
  probe,
  phase: 'during',
  minPassRatio,
  check,
});
const recovery = (probe: ProbeName, check: ExpectationCheck): Expectation => ({
  probe,
  phase: 'recovery',
  minPassRatio: 1,
  check,
});

export const SCENARIOS: Scenario[] = [
  {
    name: 'indexer-partition',
    description:
      'oracle-service loses the indexer entirely: verdicts must degrade to low-confidence answers, not 5xx, and health must stay reachable.',
    fault: { proxy: 'indexer-upstream', kind: 'partition' },
    durationMs: 45_000,
    sampleIntervalMs: 5_000,
    recoveryTimeoutMs: 60_000,
    expectations: [
      during('oracleHealth', { kind: 'status', anyOf: [200] }),
      during('oracleHealth', { kind: 'jsonField', path: 'status', anyOf: ['ok', 'degraded'] }),
      during('oracleVerify', { kind: 'no5xx' }),
      during('oracleVerify', { kind: 'latencyBelowMs', ms: 6_000 }, 0.9),
      recovery('oracleHealth', { kind: 'jsonField', path: 'status', anyOf: ['ok'] }),
      recovery('oracleVerify', { kind: 'status', anyOf: [200] }),
    ],
  },
  {
    name: 'indexer-latency-2s',
    description:
      'Every oracle → indexer request takes 2s ± 500ms; the oracle must answer within its own request timeout budget and never error.',
    fault: {
      proxy: 'indexer-upstream',
      kind: 'toxics',
      toxics: [{ name: 'latency', type: 'latency', attributes: { latency: 2_000, jitter: 500 } }],
    },
    durationMs: 45_000,
    sampleIntervalMs: 5_000,
    recoveryTimeoutMs: 30_000,
    expectations: [
      during('oracleVerify', { kind: 'no5xx' }),
      during('oracleVerify', { kind: 'latencyBelowMs', ms: 6_000 }, 0.9),
      during('oracleHealth', { kind: 'status', anyOf: [200] }),
      recovery('oracleVerify', { kind: 'latencyBelowMs', ms: 2_000 }),
    ],
  },
  {
    name: 'indexer-connection-resets',
    description:
      'Half of the oracle → indexer connections are reset by the peer after 500ms and the rest are fragmented; the oracle must keep serving.',
    fault: {
      proxy: 'indexer-upstream',
      kind: 'toxics',
      toxics: [
        { name: 'reset', type: 'reset_peer', toxicity: 0.5, attributes: { timeout: 500 } },
        {
          name: 'slice',
          type: 'slicer',
          attributes: { average_size: 64, size_variation: 32, delay: 20_000 },
        },
      ],
    },
    durationMs: 45_000,
    sampleIntervalMs: 5_000,
    recoveryTimeoutMs: 30_000,
    expectations: [
      during('oracleVerify', { kind: 'no5xx' }),
      during('oracleHealth', { kind: 'status', anyOf: [200] }),
      recovery('oracleVerify', { kind: 'status', anyOf: [200] }),
    ],
  },
  {
    name: 'rpc-outage-indexer',
    description:
      'The indexer loses the Soroban RPC: the poller must log and keep running, the read API must stay up, and the cursor must resume advancing once the RPC is back.',
    fault: { proxy: 'rpc-indexer', kind: 'partition' },
    durationMs: 60_000,
    sampleIntervalMs: 10_000,
    recoveryTimeoutMs: 120_000,
    expectations: [
      during('indexerHealth', { kind: 'status', anyOf: [200, 503] }),
      during('indexerHealth', { kind: 'jsonField', path: 'db', anyOf: ['ok'] }),
      recovery('indexerHealth', { kind: 'status', anyOf: [200] }),
      recovery('indexerHealth', { kind: 'jsonField', path: 'status', anyOf: ['ok'] }),
    ],
  },
  {
    name: 'rpc-latency-notifications',
    description:
      'Notifications see 3s RPC latency: the service must stay healthy and its provider health checks unaffected.',
    fault: {
      proxy: 'rpc-notifications',
      kind: 'toxics',
      toxics: [{ name: 'latency', type: 'latency', attributes: { latency: 3_000, jitter: 300 } }],
    },
    durationMs: 45_000,
    sampleIntervalMs: 5_000,
    recoveryTimeoutMs: 30_000,
    expectations: [
      during('notificationsHealth', { kind: 'status', anyOf: [200] }),
      during('notificationsProviders', { kind: 'status', anyOf: [200] }),
      recovery('notificationsHealth', { kind: 'status', anyOf: [200] }),
    ],
  },
];

export const PROXY_NAMES: ProxyName[] = ['rpc-indexer', 'indexer-upstream', 'rpc-notifications'];
export const PROBE_NAMES: ProbeName[] = [
  'oracleHealth',
  'oracleVerify',
  'indexerHealth',
  'notificationsHealth',
  'notificationsProviders',
];

/** Structural validation used by the unit tests and by the runner before touching anything. */
export function validateScenarios(scenarios: Scenario[]): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const s of scenarios) {
    if (names.has(s.name)) problems.push(`${s.name}: duplicate name`);
    names.add(s.name);
    if (!PROXY_NAMES.includes(s.fault.proxy))
      problems.push(`${s.name}: unknown proxy ${s.fault.proxy}`);
    if (s.fault.kind === 'toxics' && !s.fault.toxics?.length)
      problems.push(`${s.name}: toxics fault without toxics`);
    if (s.fault.kind === 'partition' && s.fault.toxics)
      problems.push(`${s.name}: partition fault must not list toxics`);
    if (s.durationMs < 10_000 || s.durationMs > 600_000)
      problems.push(`${s.name}: durationMs must be between 10s and 10m`);
    if (s.sampleIntervalMs <= 0 || s.sampleIntervalMs > s.durationMs)
      problems.push(`${s.name}: sampleIntervalMs must be within the duration`);
    if (s.expectations.length === 0) problems.push(`${s.name}: no expectations`);
    for (const e of s.expectations) {
      if (!PROBE_NAMES.includes(e.probe)) problems.push(`${s.name}: unknown probe ${e.probe}`);
      if (e.minPassRatio <= 0 || e.minPassRatio > 1)
        problems.push(`${s.name}: minPassRatio out of range`);
    }
    if (!s.expectations.some((e) => e.phase === 'recovery'))
      problems.push(`${s.name}: no recovery expectation`);
  }
  return problems;
}
