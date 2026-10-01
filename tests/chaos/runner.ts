import { evaluate, PROBES, type Endpoints, type ProbeFn, type Sample } from './probes';
import { validateScenarios, type Expectation, type ProbeName, type Scenario } from './scenarios';
import type { ToxiproxyClient } from './toxiproxy-client';

export interface ExpectationResult {
  expectation: Expectation;
  samples: number;
  passed: number;
  passRatio: number;
  ok: boolean;
}

export interface ScenarioResult {
  scenario: string;
  description: string;
  startedAt: number;
  finishedAt: number;
  ok: boolean;
  recoveredAfterMs: number | null;
  expectations: ExpectationResult[];
  error?: string;
}

export interface RunnerDeps {
  toxiproxy: Pick<ToxiproxyClient, 'disable' | 'enable' | 'addToxic' | 'removeToxic' | 'reset'>;
  probes?: Partial<Record<ProbeName, ProbeFn>>;
  endpoints?: Endpoints;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Multiplies every duration; the unit tests use a tiny factor. */
  timeScale?: number;
  log?: (line: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function applyFault(scenario: Scenario, toxiproxy: RunnerDeps['toxiproxy']): Promise<void> {
  if (scenario.fault.kind === 'partition') {
    await toxiproxy.disable(scenario.fault.proxy);
    return;
  }
  for (const toxic of scenario.fault.toxics ?? []) {
    await toxiproxy.addToxic(scenario.fault.proxy, toxic);
  }
}

async function heal(scenario: Scenario, toxiproxy: RunnerDeps['toxiproxy']): Promise<void> {
  if (scenario.fault.kind === 'partition') {
    await toxiproxy.enable(scenario.fault.proxy);
    return;
  }
  for (const toxic of scenario.fault.toxics ?? []) {
    await toxiproxy.removeToxic(scenario.fault.proxy, toxic.name).catch(() => undefined);
  }
}

function summarise(expectation: Expectation, samples: Sample[]): ExpectationResult {
  const relevant = samples.filter((s) => s.probe === expectation.probe);
  const passed = relevant.filter((s) => evaluate(expectation.check, s)).length;
  const passRatio = relevant.length === 0 ? 0 : passed / relevant.length;
  return {
    expectation,
    samples: relevant.length,
    passed,
    passRatio,
    ok: relevant.length > 0 && passRatio >= expectation.minPassRatio,
  };
}

/** Runs one scenario end to end. The link is always healed, even if probes or Toxiproxy throw. */
export async function runScenario(scenario: Scenario, deps: RunnerDeps): Promise<ScenarioResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const scale = deps.timeScale ?? 1;
  const log = deps.log ?? (() => undefined);
  const endpoints = deps.endpoints ?? { oracleUrl: '', indexerUrl: '', notificationsUrl: '' };
  const probes = { ...PROBES, ...deps.probes };
  const probeNames = [...new Set(scenario.expectations.map((e) => e.probe))];
  const sampleAll = async (): Promise<Sample[]> =>
    Promise.all(probeNames.map((name) => probes[name](endpoints)));

  const startedAt = now();
  const duringSamples: Sample[] = [];
  const recoverySamples: Sample[] = [];
  let recoveredAfterMs: number | null = null;
  let error: string | undefined;

  try {
    log(`[${scenario.name}] injecting fault on ${scenario.fault.proxy} (${scenario.fault.kind})`);
    await applyFault(scenario, deps.toxiproxy);
    const faultEnd = now() + scenario.durationMs * scale;
    while (now() < faultEnd) {
      duringSamples.push(...(await sampleAll()));
      await sleep(scenario.sampleIntervalMs * scale);
    }
  } catch (err) {
    error = `fault phase failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    log(`[${scenario.name}] healing ${scenario.fault.proxy}`);
    await heal(scenario, deps.toxiproxy);
  }

  const recoveryExpectations = scenario.expectations.filter((e) => e.phase === 'recovery');
  if (!error && recoveryExpectations.length > 0) {
    const healedAt = now();
    const deadline = healedAt + scenario.recoveryTimeoutMs * scale;
    while (now() <= deadline) {
      const samples = await sampleAll();
      const allPass = recoveryExpectations.every((e) =>
        samples.filter((s) => s.probe === e.probe).every((s) => evaluate(e.check, s))
      );
      if (allPass) {
        recoverySamples.push(...samples);
        recoveredAfterMs = now() - healedAt;
        break;
      }
      await sleep(scenario.sampleIntervalMs * scale);
    }
    if (recoveredAfterMs === null) {
      // Keep the last observation so the report shows what the service looked like when time ran out.
      recoverySamples.push(...(await sampleAll()));
    }
  }

  const expectations = scenario.expectations.map((e) =>
    e.phase === 'during'
      ? summarise(e, duringSamples)
      : {
          ...summarise(e, recoverySamples),
          ok: recoveredAfterMs !== null && summarise(e, recoverySamples).ok,
        }
  );
  const ok = !error && expectations.every((e) => e.ok);
  log(
    `[${scenario.name}] ${ok ? 'PASS' : 'FAIL'}${
      recoveredAfterMs !== null ? ` (recovered in ${recoveredAfterMs}ms)` : ''
    }`
  );
  return {
    scenario: scenario.name,
    description: scenario.description,
    startedAt,
    finishedAt: now(),
    ok,
    recoveredAfterMs,
    expectations,
    error,
  };
}

/** Runs every scenario sequentially and resets Toxiproxy at the end no matter what. */
export async function runSuite(scenarios: Scenario[], deps: RunnerDeps): Promise<ScenarioResult[]> {
  const problems = validateScenarios(scenarios);
  if (problems.length) throw new Error(`invalid scenarios:\n${problems.join('\n')}`);
  const results: ScenarioResult[] = [];
  try {
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario, deps));
    }
  } finally {
    await deps.toxiproxy.reset().catch(() => undefined);
  }
  return results;
}
