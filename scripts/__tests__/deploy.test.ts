import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runDeployment, type DeployOptions } from '../deploy';

// Exercises scripts/deploy.ts end to end against a fake `stellar` CLI (a
// shell stub placed first on PATH) instead of a real Stellar network, so the
// full build -> deploy -> verify -> health-check -> wire-in sequence, and its
// rollback behavior on each kind of failure, run for real.

const fakeStellar = resolve(import.meta.dirname, '../__fixtures__/deploy/fake-stellar.sh');

const roots: string[] = [];
let originalPath: string;

beforeEach(() => {
  originalPath = process.env.PATH ?? '';
  const bin = mkdtempSync(join(tmpdir(), 'iln-deploy-bin-'));
  roots.push(bin);
  writeFileSync(join(bin, 'stellar'), `#!/bin/sh\nexec '${fakeStellar}' "$@"\n`);
  chmodSync(join(bin, 'stellar'), 0o755);
  process.env.PATH = `${bin}:${originalPath}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  delete process.env.DEPLOY_FAIL;
  delete process.env.VERIFY_MODE;
  delete process.env.HEALTH_MODE;
  delete process.env.WASM_SRC;
  delete process.env.DEPLOYED_CONTRACT_ID;
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'iln-deploy-'));
  roots.push(root);
  const wasmDir = join(root, 'target', 'wasm32v1-none', 'release');
  mkdirSync(wasmDir, { recursive: true });
  const wasmPath = join(wasmDir, 'invoice_liquidity.wasm');
  writeFileSync(wasmPath, 'fake-wasm-bytes');
  process.env.WASM_SRC = wasmPath;

  const envPath = join(root, '.env');
  const readmePath = join(root, 'README.md');
  writeFileSync(envPath, 'CONTRACT_ID=OLD_CONTRACT_ID\nOTHER=keep-me\n');
  writeFileSync(readmePath, '# Invoice Liquidity Network\n\nContract ID: OLD_CONTRACT_ID\n');

  const options: DeployOptions = {
    network: 'testnet',
    dryRun: false,
    envPath,
    readmePath,
    wasmDir,
    logFilePath: join(root, 'deploy-logs', 'deploy.log'),
  };
  return { root, envPath, readmePath, options };
}

describe('runDeployment', () => {
  it('builds, deploys, verifies, health-checks and wires in the new contract ID', async () => {
    const { envPath, readmePath, options } = fixture();

    const summary = await runDeployment(options);

    expect(summary.status).toBe('success');
    expect(summary.contractId).toBe('CONTRACT_FAKE_ID_123');
    expect(summary.previousContractId).toBe('OLD_CONTRACT_ID');
    expect(summary.verification?.passed).toBe(true);
    expect(summary.healthCheck?.healthy).toBe(true);
    expect(readFileSync(envPath, 'utf8')).toContain('CONTRACT_ID=CONTRACT_FAKE_ID_123');
    expect(readFileSync(envPath, 'utf8')).toContain('OTHER=keep-me');
    expect(readFileSync(readmePath, 'utf8')).toContain('Contract ID: CONTRACT_FAKE_ID_123');
  });

  it('stops before deploying and leaves runtime files untouched on --dry-run', async () => {
    const { envPath, readmePath, options } = fixture();

    const summary = await runDeployment({ ...options, dryRun: true });

    expect(summary.status).toBe('dry_run');
    expect(summary.contractId).toBeUndefined();
    expect(readFileSync(envPath, 'utf8')).toContain('CONTRACT_ID=OLD_CONTRACT_ID');
    expect(readFileSync(readmePath, 'utf8')).toContain('Contract ID: OLD_CONTRACT_ID');
  });

  it('rolls back .env and README.md when the deploy call itself fails', async () => {
    const { envPath, readmePath, options } = fixture();
    process.env.DEPLOY_FAIL = '1';

    const summary = await runDeployment(options);

    expect(summary.status).toBe('rolled_back');
    expect(summary.rolledBack).toBe(true);
    expect(summary.error).toMatch(/simulated deploy failure/);
    expect(readFileSync(envPath, 'utf8')).toContain('CONTRACT_ID=OLD_CONTRACT_ID');
    expect(readFileSync(readmePath, 'utf8')).toContain('Contract ID: OLD_CONTRACT_ID');
  });

  it('rolls back when the deployed bytecode does not match the local build', async () => {
    const { envPath, readmePath, options } = fixture();
    process.env.VERIFY_MODE = 'mismatch';

    const summary = await runDeployment(options);

    expect(summary.status).toBe('rolled_back');
    expect(summary.verification?.passed).toBe(false);
    expect(summary.error).toMatch(/Verification failed/);
    expect(readFileSync(envPath, 'utf8')).toContain('CONTRACT_ID=OLD_CONTRACT_ID');
    expect(readFileSync(readmePath, 'utf8')).toContain('Contract ID: OLD_CONTRACT_ID');
  });

  it('rolls back when the post-deploy health check gets a non-contract (RPC) error', async () => {
    const { envPath, options } = fixture();
    process.env.HEALTH_MODE = 'rpc_fail';

    const summary = await runDeployment(options);

    expect(summary.status).toBe('rolled_back');
    expect(summary.healthCheck?.healthy).toBe(false);
    expect(readFileSync(envPath, 'utf8')).toContain('CONTRACT_ID=OLD_CONTRACT_ID');
  });

  it('treats a defined contract-level error from the health check as healthy and proceeds', async () => {
    const { envPath, options } = fixture();
    process.env.HEALTH_MODE = 'contract_error';

    const summary = await runDeployment(options);

    expect(summary.status).toBe('success');
    expect(summary.healthCheck?.healthy).toBe(true);
    expect(readFileSync(envPath, 'utf8')).toContain('CONTRACT_ID=CONTRACT_FAKE_ID_123');
  });

  it('fails gracefully instead of crashing when README.md cannot be read before deploying', async () => {
    const { options } = fixture();
    const missingReadmePath = join(options.readmePath!, 'does-not-exist.md');

    const summary = await runDeployment({ ...options, readmePath: missingReadmePath });

    expect(summary.status).toBe('failed');
    expect(summary.rolledBack).toBe(false);
    expect(summary.error).toBeTruthy();
  });
});
