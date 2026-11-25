import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MANIFEST,
  E2E_COMPOSE_FILE,
  EXPECTED_E2E_RPC_URL,
  addDaysIso,
  isoDateToUtcMs,
  readComposeServiceImage,
  validateEnvironmentOwnership,
} from '../check-e2e-environment-rotation.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AS_OF = '2026-10-16';

/** A minimal, valid manifest; individual tests mutate a deep clone. */
function baseManifest() {
  return {
    control: 'e2e-environment-ownership',
    version: 1,
    owners: {
      primary: 'release-engineering',
      secondary: 'e2e-suite-maintainers',
      escalation: 'security-oncall',
    },
    rotation: {
      interval_days: 90,
      min_remaining_days: 14,
      credentials: [
        {
          name: 'E2E contract deployer identity',
          type: 'stellar-keypair',
          location: 'GitHub Actions secret E2E_DEPLOYER_SECRET_KEY',
          rotation_days: 90,
          last_rotated: '2026-10-01',
          next_rotation_due: '2026-12-30',
        },
      ],
    },
    environment: {
      name: 'e2e-local-stellar',
      provider: 'github-actions-ubuntu-latest',
      node_image: 'stellar/quickstart:latest',
      rpc_url: EXPECTED_E2E_RPC_URL,
    },
    runbook: 'docs/runbooks/e2e-environment-ownership.md',
  };
}

function validate(manifest, options = {}) {
  return validateEnvironmentOwnership(manifest, { asOf: AS_OF, ...options });
}

describe('date helpers', () => {
  it('parses strict ISO dates and rejects malformed ones', () => {
    assert.equal(isoDateToUtcMs('2026-10-01'), Date.UTC(2026, 9, 1));
    assert.ok(Number.isNaN(isoDateToUtcMs('2026-13-01')));
    assert.ok(Number.isNaN(isoDateToUtcMs('2026-02-30')));
    assert.ok(Number.isNaN(isoDateToUtcMs('01-10-2026')));
  });

  it('adds days across month boundaries', () => {
    assert.equal(addDaysIso('2026-10-01', 90), '2026-12-30');
    assert.equal(addDaysIso('2026-12-30', 1), '2026-12-31');
  });
});

describe('validateEnvironmentOwnership — success', () => {
  it('accepts a well-formed manifest that is not due for rotation', () => {
    const result = validate(baseManifest());

    assert.equal(result.ok, true, JSON.stringify(result.violations));
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.summary.owner, 'release-engineering');
    assert.equal(result.summary.credentials[0].remaining_days, 75);
  });

  it('accepts the checked-in repository manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, DEFAULT_MANIFEST), 'utf8'));
    const result = validate(manifest, { rootDir: REPO_ROOT });

    assert.equal(result.ok, true, JSON.stringify(result.violations));
    assert.equal(result.summary.credentials.length, manifest.rotation.credentials.length);
  });
});

describe('validateEnvironmentOwnership — failures', () => {
  it('rejects a manifest that is not the expected control', () => {
    const manifest = baseManifest();
    manifest.control = 'something-else';
    const result = validate(manifest);

    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === 'invalid-control'));
  });

  it('rejects a missing owner role', () => {
    const manifest = baseManifest();
    manifest.owners.escalation = '   ';
    const result = validate(manifest);

    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === 'missing-owner'));
  });

  it('rejects an empty credential list', () => {
    const manifest = baseManifest();
    manifest.rotation.credentials = [];
    const result = validate(manifest);

    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === 'missing-credentials'));
  });

  it('rejects a credential whose due date does not match last_rotated + rotation_days', () => {
    const manifest = baseManifest();
    manifest.rotation.credentials[0].next_rotation_due = '2026-12-31';
    const result = validate(manifest);

    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === 'inconsistent-dates'));
  });

  it('fails when a credential rotation is overdue', () => {
    const manifest = baseManifest();
    const result = validate(manifest, { asOf: '2027-01-15' });

    assert.equal(result.ok, false);
    const overdue = result.violations.find((v) => v.code === 'rotation-overdue');
    assert.ok(overdue, JSON.stringify(result.violations));
    assert.match(overdue.message, /overdue/);
  });

  it('rejects a missing manifest object', () => {
    const result = validate(null);
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === 'invalid-manifest'));
  });

  it('rejects a runbook path that does not exist', () => {
    const manifest = baseManifest();
    manifest.runbook = 'docs/runbooks/does-not-exist.md';
    const result = validate(manifest, { rootDir: REPO_ROOT });

    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === 'missing-runbook'));
  });

  it('rejects a missing environment block', () => {
    const manifest = baseManifest();
    delete manifest.environment;
    const result = validate(manifest);

    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === 'missing-environment'));
  });

  it('rejects an environment block missing a required field', () => {
    const manifest = baseManifest();
    manifest.environment.node_image = '';
    const result = validate(manifest);

    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === 'invalid-environment'));
  });

  it('rejects environment.rpc_url that does not match what E2E tooling actually uses', () => {
    const manifest = baseManifest();
    manifest.environment.rpc_url = 'http://localhost:8000/rpc';
    const result = validate(manifest);

    assert.equal(result.ok, false);
    const mismatch = result.violations.find((v) => v.code === 'environment-mismatch');
    assert.ok(mismatch, JSON.stringify(result.violations));
    assert.match(mismatch.message, /rpc_url/);
  });

  it('rejects environment.node_image that has drifted from tests/e2e/docker-compose.yml', () => {
    const manifest = baseManifest();
    manifest.environment.node_image = 'stellar/quickstart:testing';
    const result = validate(manifest, { rootDir: REPO_ROOT });

    assert.equal(result.ok, false);
    const mismatch = result.violations.find((v) => v.code === 'environment-mismatch');
    assert.ok(mismatch, JSON.stringify(result.violations));
    assert.match(mismatch.message, /node_image/);
  });
});

describe('readComposeServiceImage', () => {
  it('extracts the image for a named service', () => {
    const compose = [
      'services:',
      '  stellar-quickstart:',
      '    image: stellar/quickstart:latest',
      '    command: --local',
    ].join('\n');

    assert.equal(readComposeServiceImage(compose, 'stellar-quickstart'), 'stellar/quickstart:latest');
  });

  it('returns null for an unknown service', () => {
    const compose = 'services:\n  stellar-quickstart:\n    image: stellar/quickstart:latest\n';
    assert.equal(readComposeServiceImage(compose, 'does-not-exist'), null);
  });

  it('matches the image this repository actually ships in tests/e2e/docker-compose.yml', () => {
    const composeText = readFileSync(resolve(REPO_ROOT, E2E_COMPOSE_FILE), 'utf8');
    const image = readComposeServiceImage(composeText, 'stellar-quickstart');

    assert.ok(image, 'expected to find an image for the stellar-quickstart service');
  });
});

describe('validateEnvironmentOwnership — warnings', () => {
  it('warns (without failing) when a rotation is due soon', () => {
    const manifest = baseManifest();
    const result = validate(manifest, { asOf: '2026-12-20' });

    assert.equal(result.ok, true, JSON.stringify(result.violations));
    assert.ok(result.warnings.some((w) => w.code === 'rotation-due-soon'));
  });
});
