#!/usr/bin/env node

/**
 * scripts/canary/rollout.mjs
 *
 * Canary rollout orchestrator (issue #1095) for indexer, oracle-service, and
 * notifications. Platform-agnostic by design: this repo has no existing CD
 * pipeline for these three services (they're deployed externally today — see
 * docs/canary-deployment.md for what that means and doesn't mean), so
 * `--start-command` / `--promote-command` / `--rollback-command` are
 * caller-supplied shell commands for whatever the actual deploy target is
 * (a platform CLI call, a docker compose invocation, an ssh+systemctl
 * command, ...). This script owns the decision — bake, poll, compare against
 * docs/slos.md-derived thresholds, decide — not the mechanics of any one
 * platform.
 *
 * `runRollout` is the testable core (scripts/canary/rollout-drill.mjs and
 * scripts/__tests__/canary-rollout.test.mjs exercise it with fake adapters,
 * no real Prometheus/shell commands/timers). `main` wires it to real
 * Prometheus, real shell commands, and real timers.
 *
 * Usage:
 *   node scripts/canary/rollout.mjs \
 *     --service indexer \
 *     --prometheus-url http://localhost:9090 \
 *     --start-command "..."   \
 *     --promote-command "..." \
 *     --rollback-command "..."
 */

import { execSync } from 'node:child_process';
import { getPolicy } from './policy.mjs';
import { sampleCanary } from './prometheus-adapter.mjs';
import { decide } from './rollout-decision.mjs';
import { buildAuditEntry, appendEntry, DEFAULT_LOG_PATH } from '../release-audit-log.mjs';

/**
 * Runs the full bake/poll/decide loop. All I/O is injected, so this has no
 * hidden dependency on real time, network, or shell commands.
 *
 * @param {object} opts
 * @param {object} opts.policy - from getPolicy(service)
 * @param {() => Promise<{errorRatio:number, latencyP95Seconds:number}>} opts.sampleFn
 * @param {() => Promise<void> | void} opts.startFn
 * @param {() => Promise<void> | void} opts.promoteFn
 * @param {(reason: string) => Promise<void> | void} opts.rollbackFn
 * @param {(seconds: number) => Promise<void>} opts.sleepFn
 * @param {number} [opts.maxIterations] - safety cap; defaults to 2x the bake window's sample count
 * @returns {Promise<{decision: 'promote'|'rollback', reason: string, samples: number}>}
 */
export async function runRollout({ policy, sampleFn, startFn, promoteFn, rollbackFn, sleepFn, maxIterations }) {
  const bakeSamplesNeeded = Math.ceil((policy.bakeMinutes * 60) / policy.pollIntervalSeconds);
  const cap = maxIterations ?? bakeSamplesNeeded * 2;

  await startFn();

  const samples = [];
  for (let i = 0; i < cap; i++) {
    await sleepFn(policy.pollIntervalSeconds);
    samples.push(await sampleFn());

    const result = decide(policy, samples);

    if (result.decision === 'rollback') {
      await rollbackFn(result.reason);
      return { decision: 'rollback', reason: result.reason, samples: samples.length };
    }
    if (result.decision === 'promote') {
      await promoteFn();
      return { decision: 'promote', reason: result.reason, samples: samples.length };
    }
    // 'hold' — keep polling.
  }

  const reason = `Bake window exceeded (${cap} polls) without a promote decision; failing safe.`;
  await rollbackFn(reason);
  return { decision: 'rollback', reason, samples: samples.length };
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function runShell(command, label) {
  if (!command) {
    console.log(`(no ${label} command supplied — skipping)`);
    return;
  }
  console.log(`$ ${command}`);
  execSync(command, { stdio: 'inherit', shell: '/bin/bash' });
}

async function main() {
  const args = process.argv.slice(2);
  const service = getArg(args, '--service');
  const prometheusUrl = getArg(args, '--prometheus-url') ?? 'http://localhost:9090';
  const startCommand = getArg(args, '--start-command');
  const promoteCommand = getArg(args, '--promote-command');
  const rollbackCommand = getArg(args, '--rollback-command');

  const policy = getPolicy(service);

  const outcome = await runRollout({
    policy,
    sampleFn: () => sampleCanary(prometheusUrl, policy, service),
    startFn: () => runShell(startCommand, 'start'),
    promoteFn: () => runShell(promoteCommand, 'promote'),
    rollbackFn: (reason) => {
      console.error(`Rolling back canary for "${service}": ${reason}`);
      runShell(rollbackCommand, 'rollback');
    },
    sleepFn: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
  });

  appendEntry(
    DEFAULT_LOG_PATH,
    buildAuditEntry({
      actor: process.env.GITHUB_ACTOR ?? 'canary-rollout',
      action: `canary-rollout-${service}`,
      ref: process.env.GITHUB_SHA,
      outcome: outcome.decision === 'promote' ? 'success' : 'failure',
      notes: `${outcome.reason} (${outcome.samples} sample(s) polled)`,
    })
  );

  console.log(`Canary rollout for "${service}": ${outcome.decision}. ${outcome.reason}`);
  process.exit(outcome.decision === 'promote' ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
