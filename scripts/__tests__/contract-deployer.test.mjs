import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const deployScript = join(repoRoot, 'contract-deployer', 'deploy.sh');
const roots = [];

// Well-formed Soroban contract IDs (`C` + 55 base32 characters) so the
// script's shape validation accepts them like it would a real deployment.
const RECORDED_CONTRACT_ID = `CA${'A'.repeat(54)}`;
const FRESH_DEPLOY_CONTRACT_ID = `CB${'B'.repeat(54)}`;

/** A fake `curl` that always answers Soroban RPC's getHealth as healthy. */
function writeHealthyCurlStub(bin) {
  writeFileSync(
    join(bin, 'curl'),
    '#!/bin/sh\n' +
      'echo \'{"jsonrpc":"2.0","id":1,"result":{"status":"healthy"}}\'\n'
  );
  chmodSync(join(bin, 'curl'), 0o755);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'iln-deployer-'));
  roots.push(root);
  mkdirSync(join(root, 'target', 'wasm32v1-none', 'release'), { recursive: true });
  writeFileSync(join(root, 'target', 'wasm32v1-none', 'release', 'invoice_liquidity.wasm'), 'wasm');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const calls = join(root, 'stellar-calls.log');
  writeFileSync(
    join(bin, 'stellar'),
    '#!/bin/sh\n' +
      `printf '%s\\n' "$*" >> '${calls}'\n` +
      'case "$*" in\n' +
      `  *"contract deploy"*) echo '${FRESH_DEPLOY_CONTRACT_ID}' ;;\n` +
      'esac\n'
  );
  chmodSync(join(bin, 'stellar'), 0o755);
  writeHealthyCurlStub(bin);
  return { root, bin, calls };
}

function run(root, bin, variables) {
  return spawnSync('bash', [deployScript], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...variables },
  });
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test('dry run does not call Stellar CLI or create output files', () => {
  const { root, bin, calls } = fixture();
  const result = run(root, bin, { DRY_RUN: 'true', NETWORK: 'testnet', SOURCE: 'deployer' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY RUN: would deploy WASM/);
  assert.equal(existsSync(calls), false);
  assert.equal(existsSync(join(root, '.docker-output')), false);
});

test('deploys fresh WASM and writes the well-formed returned contract ID', () => {
  const { root, bin, calls } = fixture();
  const result = run(root, bin, {});

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Contract deployed: CB/);
  assert.equal(
    readFileSync(join(root, '.docker-output', 'contract-id.txt'), 'utf8').trim(),
    FRESH_DEPLOY_CONTRACT_ID
  );
  assert.match(readFileSync(calls, 'utf8'), /contract deploy/);
});

test('fails closed instead of writing a malformed contract ID from a broken deploy', () => {
  const root = mkdtempSync(join(tmpdir(), 'iln-deployer-'));
  roots.push(root);
  mkdirSync(join(root, 'target', 'wasm32v1-none', 'release'), { recursive: true });
  writeFileSync(join(root, 'target', 'wasm32v1-none', 'release', 'invoice_liquidity.wasm'), 'wasm');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  // A `stellar` that "succeeds" but returns garbage instead of a contract ID
  // (e.g. a CLI warning line leaking onto stdout) must not be trusted.
  writeFileSync(join(bin, 'stellar'), '#!/bin/sh\necho "not-a-contract-id"\n');
  chmodSync(join(bin, 'stellar'), 0o755);
  writeHealthyCurlStub(bin);

  const result = run(root, bin, {});

  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not return a well-formed contract ID/);
  assert.equal(existsSync(join(root, '.docker-output', 'contract-id.txt')), false);
});

test('rejects a malformed EXISTING_CONTRACT_ID instead of trusting it', () => {
  const { root, bin, calls } = fixture();
  const result = run(root, bin, { EXISTING_CONTRACT_ID: 'not-a-real-id' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a well-formed contract ID/);
  assert.equal(existsSync(join(root, '.docker-output')), false);
  assert.equal(existsSync(calls), false);
});

test('retry with a recorded contract ID restores output without redeploying', () => {
  const { root, bin, calls } = fixture();
  const result = run(root, bin, { EXISTING_CONTRACT_ID: RECORDED_CONTRACT_ID });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(root, '.docker-output', 'contract-id.txt'), 'utf8').trim(),
    RECORDED_CONTRACT_ID
  );
  assert.doesNotMatch(readFileSync(calls, 'utf8'), /contract deploy/);
});

test('fails closed when Soroban RPC never reports healthy', () => {
  const { root, bin, calls } = fixture();
  writeFileSync(
    join(bin, 'curl'),
    '#!/bin/sh\necho \'{"jsonrpc":"2.0","id":1,"result":{"status":"error"}}\'\n'
  );
  chmodSync(join(bin, 'curl'), 0o755);

  const result = run(root, bin, { RPC_HEALTH_RETRIES: '1', RPC_HEALTH_DELAY_SECONDS: '0' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not report healthy/);
  assert.equal(existsSync(join(root, '.docker-output', 'contract-id.txt')), false);
  assert.equal(existsSync(calls), false);
});

test('fails closed instead of writing a placeholder contract ID (#1242)', () => {
  const root = mkdtempSync(join(tmpdir(), 'iln-deployer-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeHealthyCurlStub(bin);

  const result = run(root, bin, {});

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no built WASM found/);
  assert.match(result.stderr, /cargo build --target wasm32v1-none --release/);
  // The regression this guards: a placeholder must never reach downstream suites.
  assert.equal(existsSync(join(root, '.docker-output', 'contract-id.txt')), false);
});
