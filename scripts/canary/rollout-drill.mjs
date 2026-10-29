#!/usr/bin/env node

/**
 * scripts/canary/rollout-drill.mjs
 *
 * The drill required by issue #1095: "deliberately deploys a regression and
 * verifies the canary catches and rolls it back." Runnable on demand
 * (`node scripts/canary/rollout-drill.mjs`) and wired into CI as the
 * `canary-drill` job in .github/workflows/ci.yml.
 *
 * Unlike scripts/__tests__/canary-rollout.test.mjs (which feeds runRollout()
 * canned sample data to test the orchestration logic in isolation), this
 * drill starts two real local HTTP servers — one healthy, one deliberately
 * regressed (elevated error rate) — and has the sampler make real HTTP
 * requests against them to compute a real error ratio, so the exercise
 * covers the sampling path too, not just the decision logic. It does not
 * require Docker, Prometheus, or any cloud credentials, so it can run
 * unattended in CI on every PR.
 *
 * Exit 0 = both scenarios behaved correctly. Exit 1 = drill failure (this
 * would mean the canary mechanism itself is broken — treat as a P1).
 */

import { createServer } from 'node:http';
import { runRollout } from './rollout.mjs';

const DRILL_POLICY = {
  bakeMinutes: 4 / 60, // ~4s bake — fast enough for every CI run
  pollIntervalSeconds: 1,
  maxErrorRatio: 0.05,
  maxLatencyP95Seconds: 0.5,
};
const REQUESTS_PER_SAMPLE = 20;

function startServer({ errorRate }) {
  const server = createServer((req, res) => {
    if (Math.random() < errorRate) {
      res.writeHead(500);
      res.end('injected drill failure');
    } else {
      res.writeHead(200);
      res.end('ok');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function serverUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/health`;
}

/** Fires REQUESTS_PER_SAMPLE real HTTP requests and computes the real error ratio. */
async function sampleViaHttp(url) {
  let errors = 0;
  const start = Date.now();
  for (let i = 0; i < REQUESTS_PER_SAMPLE; i++) {
    const res = await fetch(url);
    if (!res.ok) errors++;
  }
  const elapsedSeconds = (Date.now() - start) / 1000 / REQUESTS_PER_SAMPLE;
  return { errorRatio: errors / REQUESTS_PER_SAMPLE, latencyP95Seconds: elapsedSeconds };
}

async function runScenario(name, { errorRate, expectedDecision }) {
  const server = await startServer({ errorRate });
  const url = serverUrl(server);
  const events = [];

  try {
    const result = await runRollout({
      policy: DRILL_POLICY,
      sampleFn: () => sampleViaHttp(url),
      startFn: () => events.push('start'),
      promoteFn: () => events.push('promote'),
      rollbackFn: (reason) => events.push(`rollback: ${reason}`),
      sleepFn: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
    });

    const passed = result.decision === expectedDecision;
    console.log(
      `[${passed ? 'PASS' : 'FAIL'}] Scenario "${name}": expected ${expectedDecision}, got ${result.decision} (${result.reason})`
    );
    return passed;
  } finally {
    server.close();
  }
}

async function main() {
  console.log('Running canary rollout drill (issue #1095)...\n');

  const regressionPassed = await runScenario('deliberate regression', {
    errorRate: 0.8, // 80% error rate — should breach maxErrorRatio (0.05) immediately
    expectedDecision: 'rollback',
  });

  const healthyPassed = await runScenario('healthy canary', {
    errorRate: 0,
    expectedDecision: 'promote',
  });

  const allPassed = regressionPassed && healthyPassed;
  console.log(`\nDrill ${allPassed ? 'PASSED' : 'FAILED'}.`);
  process.exit(allPassed ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
