import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const seedScript = join(repoRoot, 'account-seeder', 'seed.sh');
const roots = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'iln-seeder-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const calls = join(root, 'stellar-calls.log');
  const state = join(root, 'mock-state');
  // Produces real-shaped (but fake) G.../S... keys so the seeder's own
  // key-format validation (issue #1499) accepts them, instead of the
  // underscore-prefixed placeholders used previously. Controllable via env
  // vars so individual tests can simulate a conflicting "local" network
  // alias, an unrelated `network add` failure, or a malformed key.
  writeFileSync(
    join(bin, 'stellar'),
    `#!/bin/bash
set -e
b32() { tr 'a-z0-9' 'A-Z234567' | tr -cd 'A-Z2-7'; }
pad() { printf '%s%s' "$(cat)" "$(printf 'A%.0s' {1..60})" | cut -c1-55; }
case "$1 $2" in
  'network add')
    if [ "\${MOCK_NETWORK_ADD_FAIL_OTHER:-}" = '1' ]; then
      echo 'mock: permission denied' >&2
      exit 1
    fi
    if [ "\${MOCK_NETWORK_ADD_CONFLICT:-}" = '1' ] && [ ! -f '${state}/network-add-attempted' ]; then
      mkdir -p '${state}'
      touch '${state}/network-add-attempted'
      echo "mock: network 'local' already exists" >&2
      exit 1
    fi
    printf '%s\\n' "$*" >> '${calls}'
    ;;
  'network rm')
    printf '%s\\n' "$*" >> '${calls}'
    ;;
  'keys address')
    if [ "\${MOCK_BAD_KEY_FOR:-}" = "$3" ]; then printf 'not-a-valid-key\\n'; exit 0; fi
    printf 'G%s\\n' "$(printf '%s' "$3" | b32 | pad)"
    ;;
  'keys show')
    if [ "\${MOCK_BAD_KEY_FOR:-}" = "$3" ]; then printf 'not-a-valid-secret\\n'; exit 0; fi
    printf 'S%s\\n' "$(printf '%s' "$3" | b32 | pad)"
    ;;
  'contract asset') printf 'C_MOCK_ASSET\\n' ;;
  *) printf '%s\\n' "$*" >> '${calls}' ;;
esac
`
  );
  chmodSync(join(bin, 'stellar'), 0o755);
  mkdirSync(join(root, '.docker-output'));
  writeFileSync(join(root, '.docker-output', 'contract-id.txt'), 'C_REAL_CONTRACT\n');
  return { root, bin, calls, state };
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test('scenario controls create multiple actor groups, invoice history, and funder positions', () => {
  const { root, bin, calls } = fixture();
  const result = spawnSync('bash', [seedScript], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FREELANCER_COUNT: '2',
      PAYER_COUNT: '2',
      FUNDER_COUNT: '2',
      INVOICES_PER_FREELANCER: '2',
      FUNDED_INVOICE_COUNT: '2',
      FIRST_INVOICE_ID: '7',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const accountsJson = readFileSync(join(root, '.docker-output', 'accounts.json'), 'utf8');
  let accounts;
  try {
    accounts = JSON.parse(accountsJson);
  } catch (error) {
    assert.fail(`${error.message}\n${accountsJson}`);
  }
  assert.equal(Object.keys(accounts.freelancers).length, 2);
  assert.equal(Object.keys(accounts.payers).length, 2);
  assert.equal(Object.keys(accounts.funders).length, 2);
  const log = readFileSync(calls, 'utf8');
  assert.equal((log.match(/submit_invoice/g) ?? []).length, 4);
  assert.equal((log.match(/fund_invoice/g) ?? []).length, 2);
  assert.match(log, /--invoice_id 7/);
  assert.match(log, /--invoice_id 8/);
});

test('recovers from a conflicting "local" network alias by removing and re-pinning it', () => {
  const { root, bin, calls } = fixture();
  const result = spawnSync('bash', [seedScript], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_NETWORK_ADD_CONFLICT: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  const log = readFileSync(calls, 'utf8');
  assert.match(log, /network rm local/);
  assert.ok(
    (log.match(/network add local/g) ?? []).length >= 1,
    'expected the seeder to re-add the local network after removing the conflicting alias'
  );
});

test('fails closed and seeds nothing when the local network cannot be configured for a non-conflict reason', () => {
  const { root, bin, calls } = fixture();
  const result = spawnSync('bash', [seedScript], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_NETWORK_ADD_FAIL_OTHER: '1' },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Failed to configure the local Stellar network/);
  assert.equal(existsSync(join(root, '.docker-output', 'accounts.json')), false);
  assert.equal(existsSync(calls) && readFileSync(calls, 'utf8').includes('keys generate'), false);
});

test('refuses to persist a malformed public or secret key instead of writing it to accounts.json', () => {
  const { root, bin } = fixture();
  const result = spawnSync('bash', [seedScript], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_BAD_KEY_FOR: 'freelancer' },
  });

  assert.equal(result.status, 3);
  assert.match(result.stderr, /invalid public key/);
  assert.equal(existsSync(join(root, '.docker-output', 'accounts.json')), false);
});
