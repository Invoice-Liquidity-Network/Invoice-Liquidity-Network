#!/usr/bin/env node
/**
 * check-e2e-environment-rotation.mjs — the machine-checkable half of the
 * "E2E environment ownership and rotation" control (#1254).
 *
 * The E2E environment's owner and the rotation state of its credentials are
 * recorded in `tests/e2e/environment-ownership.json`. Documentation alone cannot
 * fail a build, so this gate reads that manifest and fails when:
 *   - the manifest is missing/malformed or names a different control,
 *   - an ownership role is empty,
 *   - a credential is missing fields or has inconsistent dates
 *     (`next_rotation_due != last_rotated + rotation_days`), or
 *   - a credential is past its `next_rotation_due` (`rotation-overdue`), or
 *   - the manifest's `environment` block (the node image / RPC URL it claims
 *     the E2E suite runs against) has drifted from what `tests/e2e/docker-
 *     compose.yml` and the rest of the E2E tooling actually provision
 *     (`environment-mismatch`). A stale `environment` block is as dangerous
 *     as a stale credential: it lets the manifest claim an environment that
 *     no longer matches what CI actually exercises.
 *
 * A credential that lapses within `rotation.min_remaining_days` produces a
 * `rotation-due-soon` warning without failing the build, so operators get an
 * early signal without blocking unrelated PRs.
 *
 * See docs/runbooks/e2e-environment-ownership.md for the operator runbook.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MANIFEST = 'tests/e2e/environment-ownership.json';
export const EXPECTED_CONTROL = 'e2e-environment-ownership';
export const OWNER_ROLES = ['primary', 'secondary', 'escalation'];
export const ENVIRONMENT_FIELDS = ['name', 'provider', 'node_image', 'rpc_url'];
// The compose file `scripts/provision-e2e-node.mjs` actually runs in CI
// (docker compose -f tests/e2e/docker-compose.yml up -d stellar-quickstart)
// — the real source of truth for which node image E2E runs against.
export const E2E_COMPOSE_FILE = 'tests/e2e/docker-compose.yml';
// Used consistently by provision-e2e-node.mjs, wait-for-stellar-rpc.mjs, and
// every E2E test file's RPC_URL constant.
export const EXPECTED_E2E_RPC_URL = 'http://localhost:8000/soroban/rpc';

/**
 * Extract the `image:` value for `service` from a Docker Compose YAML file's
 * raw text. Deliberately avoids a YAML dependency: the compose files this
 * repo uses are flat enough that scanning for the service header followed by
 * an indented `image:` line is unambiguous.
 */
export function readComposeServiceImage(composeText, service) {
  const serviceHeader = new RegExp(`^\\s*${service}:\\s*$`, 'm');
  const headerMatch = serviceHeader.exec(composeText);
  if (!headerMatch) return null;
  const rest = composeText.slice(headerMatch.index + headerMatch[0].length);
  const imageMatch = /^\s+image:\s*(\S+)\s*$/m.exec(rest);
  return imageMatch ? imageMatch[1] : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse `--flag=value` / `--flag` arguments into a plain object. */
export function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(token);
    if (!match) continue;
    const [, key, value] = match;
    args[key] = value === undefined ? true : value;
  }
  return args;
}

/** Parse a strict `YYYY-MM-DD` date to UTC milliseconds, or `NaN` when invalid. */
export function isoDateToUtcMs(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const [year, month, day] = value.split('-').map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return NaN;
  }
  return ms;
}

/** Return `iso` + `days` as a `YYYY-MM-DD` string, or `null` for an invalid input. */
export function addDaysIso(iso, days) {
  const ms = isoDateToUtcMs(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Validate an environment-ownership manifest.
 *
 * @param {unknown} manifest parsed manifest
 * @param {{ asOf?: string, minRemainingDays?: number, rootDir?: string }} [options]
 * @returns {{ ok: boolean, violations: Array<{code:string,message:string}>, warnings: Array<{code:string,message:string}>, summary: object }}
 */
export function validateEnvironmentOwnership(manifest, options = {}) {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const asOfMs = isoDateToUtcMs(asOf);
  const violations = [];
  const warnings = [];
  const summary = { control: null, owner: null, as_of: asOf, credentials: [] };

  const fail = (code, message) => violations.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('invalid-manifest', 'manifest must be a JSON object');
    return { ok: false, violations, warnings, summary };
  }

  summary.control = typeof manifest.control === 'string' ? manifest.control : null;
  if (manifest.control !== EXPECTED_CONTROL) {
    fail('invalid-control', `control must be "${EXPECTED_CONTROL}"`);
  }

  const owners = manifest.owners;
  if (!owners || typeof owners !== 'object' || Array.isArray(owners)) {
    fail('missing-owners', 'owners block is required');
  } else {
    for (const role of OWNER_ROLES) {
      if (typeof owners[role] !== 'string' || owners[role].trim() === '') {
        fail('missing-owner', `owners.${role} must be a non-empty string`);
      }
    }
    summary.owner = typeof owners.primary === 'string' ? owners.primary : null;
  }

  const rotation = manifest.rotation;
  if (!rotation || typeof rotation !== 'object' || Array.isArray(rotation)) {
    fail('missing-rotation', 'rotation block is required');
  } else {
    const minRemainingDays = Number.isFinite(options.minRemainingDays)
      ? options.minRemainingDays
      : Number(rotation.min_remaining_days ?? 14);

    if (!Array.isArray(rotation.credentials) || rotation.credentials.length === 0) {
      fail('missing-credentials', 'rotation.credentials must be a non-empty array');
    } else {
      rotation.credentials.forEach((credential, index) => {
        const label =
          credential && typeof credential.name === 'string' && credential.name.trim() !== ''
            ? credential.name
            : `credential[${index}]`;

        if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
          fail('invalid-credential', `${label} must be an object`);
          return;
        }

        for (const field of ['name', 'location']) {
          if (typeof credential[field] !== 'string' || credential[field].trim() === '') {
            fail('invalid-credential', `${label}.${field} must be a non-empty string`);
          }
        }

        const rotationDays = Number(credential.rotation_days);
        if (!Number.isInteger(rotationDays) || rotationDays <= 0) {
          fail('invalid-rotation-days', `${label}.rotation_days must be a positive integer`);
        }

        const lastMs = isoDateToUtcMs(credential.last_rotated);
        const dueMs = isoDateToUtcMs(credential.next_rotation_due);
        if (Number.isNaN(lastMs)) {
          fail('invalid-date', `${label}.last_rotated must be a YYYY-MM-DD date`);
        }
        if (Number.isNaN(dueMs)) {
          fail('invalid-date', `${label}.next_rotation_due must be a YYYY-MM-DD date`);
        }

        if (!Number.isNaN(lastMs) && Number.isInteger(rotationDays) && !Number.isNaN(dueMs)) {
          const expected = addDaysIso(credential.last_rotated, rotationDays);
          if (expected !== credential.next_rotation_due) {
            fail(
              'inconsistent-dates',
              `${label}.next_rotation_due (${credential.next_rotation_due}) must equal ` +
                `last_rotated + rotation_days (${expected})`
            );
          }

          if (!Number.isNaN(asOfMs)) {
            const remainingDays = Math.floor((dueMs - asOfMs) / DAY_MS);
            summary.credentials.push({
              name: credential.name,
              location: credential.location,
              next_rotation_due: credential.next_rotation_due,
              remaining_days: remainingDays,
            });
            if (remainingDays < 0) {
              fail(
                'rotation-overdue',
                `${label} was due on ${credential.next_rotation_due} ` +
                  `(${Math.abs(remainingDays)} day(s) overdue)`
              );
            } else if (remainingDays < minRemainingDays) {
              warn(
                'rotation-due-soon',
                `${label} is due on ${credential.next_rotation_due} ` +
                  `(${remainingDays} day(s) remaining)`
              );
            }
          }
        }
      });
    }
  }

  const environment = manifest.environment;
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    fail('missing-environment', 'environment block is required');
  } else {
    for (const field of ENVIRONMENT_FIELDS) {
      if (typeof environment[field] !== 'string' || environment[field].trim() === '') {
        fail('invalid-environment', `environment.${field} must be a non-empty string`);
      }
    }

    summary.environment = {
      name: typeof environment.name === 'string' ? environment.name : null,
      node_image: typeof environment.node_image === 'string' ? environment.node_image : null,
      rpc_url: typeof environment.rpc_url === 'string' ? environment.rpc_url : null,
    };

    if (typeof environment.rpc_url === 'string' && environment.rpc_url !== EXPECTED_E2E_RPC_URL) {
      fail(
        'environment-mismatch',
        `environment.rpc_url ("${environment.rpc_url}") does not match the RPC URL every other ` +
          `E2E script and workflow uses ("${EXPECTED_E2E_RPC_URL}")`
      );
    }

    if (typeof environment.node_image === 'string' && options.rootDir) {
      const composePath = resolve(options.rootDir, E2E_COMPOSE_FILE);
      if (!existsSync(composePath)) {
        fail(
          'environment-mismatch',
          `cannot verify environment.node_image: ${E2E_COMPOSE_FILE} does not exist`
        );
      } else {
        const actualImage = readComposeServiceImage(
          readFileSync(composePath, 'utf8'),
          'stellar-quickstart'
        );
        if (!actualImage) {
          fail(
            'environment-mismatch',
            `could not find the stellar-quickstart service's "image:" in ${E2E_COMPOSE_FILE} to ` +
              'verify environment.node_image'
          );
        } else if (actualImage !== environment.node_image) {
          fail(
            'environment-mismatch',
            `environment.node_image ("${environment.node_image}") does not match the image ` +
              `${E2E_COMPOSE_FILE} actually provisions ("${actualImage}")`
          );
        }
      }
    }
  }

  const runbook = manifest.runbook;
  if (typeof runbook !== 'string' || runbook.trim() === '') {
    fail('missing-runbook', 'runbook path is required');
  } else if (options.rootDir && !existsSync(resolve(options.rootDir, runbook))) {
    fail('missing-runbook', `runbook "${runbook}" does not exist`);
  }

  return { ok: violations.length === 0, violations, warnings, summary };
}

/** Render a human-readable report for the console. */
export function formatReport(result) {
  const lines = [];
  if (result.ok) {
    lines.push(
      `✓ E2E environment ownership & rotation OK ` +
        `(owner: ${result.summary.owner}, as of ${result.summary.as_of})`
    );
  } else {
    const count = result.violations.length;
    lines.push(`✗ E2E environment rotation FAILED (${count} violation${count === 1 ? '' : 's'})`);
  }
  for (const violation of result.violations) {
    lines.push(`  [${violation.code}] ${violation.message}`);
  }
  for (const warning of result.warnings) {
    lines.push(`  ⚠ [${warning.code}] ${warning.message}`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = typeof args.root === 'string' ? args.root : process.cwd();
  const manifestRel = typeof args.manifest === 'string' ? args.manifest : DEFAULT_MANIFEST;
  const manifestPath = resolve(rootDir, manifestRel);

  if (typeof args['as-of'] === 'string' && Number.isNaN(isoDateToUtcMs(args['as-of']))) {
    console.error(`✗ E2E environment rotation FAILED\n  [invalid-date] --as-of="${args['as-of']}" is not YYYY-MM-DD`);
    process.exitCode = 1;
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(
      `✗ E2E environment rotation FAILED\n` +
        `  [invalid-manifest] cannot read/parse ${manifestPath}: ${error.message}`
    );
    process.exitCode = 1;
    return;
  }

  const result = validateEnvironmentOwnership(manifest, {
    asOf: typeof args['as-of'] === 'string' ? args['as-of'] : undefined,
    minRemainingDays: args['min-remaining-days']
      ? Number(args['min-remaining-days'])
      : undefined,
    rootDir,
  });

  console.log(formatReport(result));

  if (typeof args.report === 'string') {
    const reportPath = resolve(rootDir, args.report);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify(
        { ...result, manifest: manifestRel, generated_at: new Date().toISOString() },
        null,
        2
      )
    );
  }

  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
