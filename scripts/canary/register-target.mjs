#!/usr/bin/env node

/**
 * scripts/canary/register-target.mjs
 *
 * Registers/deregisters a canary instance as a Prometheus scrape target via
 * file-based service discovery (see the `iln-canary` job in
 * monitoring/prometheus/prometheus.yml). Called by rollout.mjs's
 * `--start-command` / `--promote-command` / `--rollback-command` hooks — the
 * canary must be deregistered on both promote (it's no longer "the canary",
 * it's the new stable) and rollback (it's being torn down).
 *
 * Usage:
 *   node scripts/canary/register-target.mjs --register --service indexer \
 *     --host 10.0.4.12 --port 3001 --metrics-path /metrics
 *   node scripts/canary/register-target.mjs --deregister --service indexer
 */

import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

export const DEFAULT_TARGETS_DIR = join(REPO_ROOT, 'monitoring', 'prometheus', 'canary-targets');

/** Builds the Prometheus file_sd target document (an array with one group). */
export function buildTargetFile({ service, host, port, metricsPath }) {
  return [
    {
      targets: [`${host}:${port}`],
      labels: {
        deployment: 'canary',
        service,
        __metrics_path__: metricsPath,
      },
    },
  ];
}

export function targetFilePath(targetsDir, service) {
  return join(targetsDir, `${service}.json`);
}

export function registerTarget(targetsDir, { service, host, port, metricsPath }) {
  mkdirSync(targetsDir, { recursive: true });
  const content = buildTargetFile({ service, host, port, metricsPath });
  writeFileSync(targetFilePath(targetsDir, service), JSON.stringify(content, null, 2) + '\n', 'utf8');
}

export function deregisterTarget(targetsDir, service) {
  const path = targetFilePath(targetsDir, service);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function main() {
  const args = process.argv.slice(2);
  const service = getArg(args, '--service');
  const targetsDir = getArg(args, '--targets-dir') ?? DEFAULT_TARGETS_DIR;

  if (!service) {
    console.error('Usage: register-target.mjs (--register|--deregister) --service <name> [...]');
    process.exit(1);
  }

  if (args.includes('--deregister')) {
    deregisterTarget(targetsDir, service);
    console.log(`Deregistered canary Prometheus target for "${service}".`);
    return;
  }

  if (args.includes('--register')) {
    const host = getArg(args, '--host');
    const port = getArg(args, '--port');
    const metricsPath = getArg(args, '--metrics-path') ?? '/metrics';
    if (!host || !port) {
      console.error('--register requires --host and --port');
      process.exit(1);
    }
    registerTarget(targetsDir, { service, host, port, metricsPath });
    console.log(`Registered canary Prometheus target for "${service}" at ${host}:${port}.`);
    return;
  }

  console.error('Usage: register-target.mjs (--register|--deregister) --service <name> [...]');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
