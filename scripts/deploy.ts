#!/usr/bin/env node

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ── Low-level helpers ──────────────────────────────────────────────────────

/** Runs a command with output streamed straight to the terminal. Used only
 * for the build step, where we don't need to inspect output, just succeed. */
function run(cmd: string): void {
  log(`Running: ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

export interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command and always returns a result instead of throwing, so
 * callers can decide for themselves what counts as success. */
export function runCapture(cmd: string): CaptureResult {
  try {
    const stdout = execSync(cmd, {
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as {
      status?: number;
      stdout?: Buffer;
      stderr?: Buffer;
      message?: string;
    };
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : e.message ?? 'unknown error',
    };
  }
}

export function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function getWasmFile(dir = 'target/wasm32v1-none/release'): string {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.wasm'));

  if (files.length === 0) {
    throw new Error('No WASM file found. Run `stellar contract build` first.');
  }

  return path.join(dir, files[0]);
}

// ── Logging ────────────────────────────────────────────────────────────────

let activeLogFile: string | null = null;

export function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (activeLogFile) {
    fs.appendFileSync(activeLogFile, line + '\n');
  }
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function writeDeploymentSummary(summary: DeploymentSummary, logFilePath: string): void {
  fs.appendFileSync(
    logFilePath,
    `\n=== Deployment Summary ===\n${JSON.stringify(summary, null, 2)}\n`
  );
}

// ── Runtime file backup / restore (for rollback) ───────────────────────────

export interface RuntimeBackup {
  envExisted: boolean;
  envContent: string;
  readmeContent: string;
}

export function backupRuntimeFiles(envPath: string, readmePath: string): RuntimeBackup {
  const envExisted = fs.existsSync(envPath);
  return {
    envExisted,
    envContent: envExisted ? fs.readFileSync(envPath, 'utf8') : '',
    readmeContent: fs.readFileSync(readmePath, 'utf8'),
  };
}

export function restoreRuntimeFiles(
  backup: RuntimeBackup,
  envPath: string,
  readmePath: string
): void {
  if (backup.envExisted) {
    fs.writeFileSync(envPath, backup.envContent);
  } else if (fs.existsSync(envPath)) {
    fs.unlinkSync(envPath);
  }
  fs.writeFileSync(readmePath, backup.readmeContent);
}

function extractContractId(envContent: string): string | undefined {
  return envContent.match(/CONTRACT_ID=(.*)/)?.[1]?.trim() || undefined;
}

export function updateEnv(contractId: string, envPath = '.env'): void {
  let env = '';
  if (fs.existsSync(envPath)) {
    env = fs.readFileSync(envPath, 'utf8');
  }

  if (env.includes('CONTRACT_ID')) {
    env = env.replace(/CONTRACT_ID=.*/g, `CONTRACT_ID=${contractId}`);
  } else {
    env += `\nCONTRACT_ID=${contractId}\n`;
  }

  fs.writeFileSync(envPath, env);
}

export function updateReadme(contractId: string, readmePath = 'README.md'): void {
  let content = fs.readFileSync(readmePath, 'utf8');
  content = content.replace(/Contract ID:\s*.*/g, `Contract ID: ${contractId}`);
  fs.writeFileSync(readmePath, content);
}

// ── Verification (bytecode match) ──────────────────────────────────────────

export interface VerificationResult {
  passed: boolean;
  localHash: string;
  remoteHash?: string;
  error?: string;
}

/**
 * Confirms the on-chain bytecode at `contractId` is exactly the WASM we just
 * built, by fetching the deployed bytecode and comparing its SHA-256 hash
 * against the local build artifact's hash.
 */
export function verifyDeployment(
  contractId: string,
  network: string,
  wasmPath: string,
  capture: (cmd: string) => CaptureResult = runCapture
): VerificationResult {
  const localHash = hashFile(wasmPath);
  const fetchedPath = path.join(os.tmpdir(), `iln-deploy-verify-${contractId}.wasm`);

  try {
    const result = capture(
      `stellar contract fetch --id ${contractId} --network ${network} --out-file ${fetchedPath}`
    );

    if (result.code !== 0) {
      return {
        passed: false,
        localHash,
        error: result.stderr || result.stdout || 'contract fetch failed',
      };
    }
    if (!fs.existsSync(fetchedPath)) {
      return {
        passed: false,
        localHash,
        error: 'contract fetch did not produce a WASM file',
      };
    }

    const remoteHash = hashFile(fetchedPath);
    return { passed: remoteHash === localHash, localHash, remoteHash };
  } finally {
    if (fs.existsSync(fetchedPath)) {
      fs.unlinkSync(fetchedPath);
    }
  }
}

// ── Health check (liveness) ────────────────────────────────────────────────

/**
 * A Soroban contract-level error (the contract executed and returned one of
 * its own defined errors) looks like `Error(Contract, #<code>)` in CLI
 * output, or mentions the specific error name. That's a sign the contract is
 * alive and correctly enforcing its own logic - e.g. InvoiceNotFound for an
 * invoice that doesn't exist yet on a fresh deploy (this is the same check
 * documented in docs/deployment/infrastructure.md as the manual verification
 * step). Anything else (RPC/network/binary errors) is NOT a healthy contract
 * response.
 */
const CONTRACT_LEVEL_ERROR_PATTERN =
  /Error\(Contract,\s*#?\d+\)|InvoiceNotFound|HostError.*Contract/i;

export function classifyHealthCheckResult(result: CaptureResult): {
  healthy: boolean;
  reason: string;
} {
  if (result.code === 0) {
    return { healthy: true, reason: 'Contract responded successfully' };
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (CONTRACT_LEVEL_ERROR_PATTERN.test(output)) {
    return {
      healthy: true,
      reason: 'Contract returned a defined contract-level error (expected for a fresh deploy)',
    };
  }

  return {
    healthy: false,
    reason: `Health check failed: ${result.stderr || result.stdout || 'no output'}`.trim(),
  };
}

// ── Orchestration ───────────────────────────────────────────────────────────

export interface DeployOptions {
  network: 'testnet' | 'mainnet';
  dryRun: boolean;
  envPath?: string;
  readmePath?: string;
  wasmDir?: string;
  logFilePath?: string;
}

export interface DeploymentSummary {
  status: 'success' | 'dry_run' | 'rolled_back' | 'failed';
  network: string;
  startedAt: string;
  finishedAt: string;
  wasmFile?: string;
  wasmHash?: string;
  previousContractId?: string;
  contractId?: string;
  verification?: VerificationResult;
  healthCheck?: { healthy: boolean; reason: string };
  rolledBack: boolean;
  error?: string;
  logFile: string;
}

export async function runDeployment(options: DeployOptions): Promise<DeploymentSummary> {
  const { network, dryRun } = options;
  const envPath = options.envPath ?? '.env';
  const readmePath = options.readmePath ?? 'README.md';
  const wasmDir = options.wasmDir ?? 'target/wasm32v1-none/release';
  const logFilePath =
    options.logFilePath ??
    path.join('deploy-logs', `deploy-${network}-${timestampForFilename()}.log`);

  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  activeLogFile = logFilePath;

  const startedAt = new Date().toISOString();
  const summary: DeploymentSummary = {
    status: 'failed',
    network,
    startedAt,
    finishedAt: startedAt,
    rolledBack: false,
    logFile: logFilePath,
  };

  log(`Deploying Invoice Liquidity Contract to ${network}`);

  const backup = backupRuntimeFiles(envPath, readmePath);
  summary.previousContractId = extractContractId(backup.envContent);

  try {
    // 1. Build
    run('stellar contract build');

    const wasm = getWasmFile(wasmDir);
    summary.wasmFile = wasm;
    summary.wasmHash = hashFile(wasm);
    log(`WASM found: ${wasm} (sha256 ${summary.wasmHash})`);

    if (dryRun) {
      log('DRY RUN: skipping deployment');
      summary.status = 'dry_run';
      summary.finishedAt = new Date().toISOString();
      writeDeploymentSummary(summary, logFilePath);
      activeLogFile = null;
      return summary;
    }

    // 2. Deploy
    const deployResult = runCapture(`stellar contract deploy --wasm ${wasm} --network ${network}`);
    if (deployResult.code !== 0) {
      throw new Error(`Deployment failed: ${deployResult.stderr || deployResult.stdout}`);
    }

    const contractId = deployResult.stdout.trim().split('\n').pop()?.trim();
    if (!contractId) {
      throw new Error('Failed to retrieve contract ID from deploy output');
    }
    summary.contractId = contractId;
    log(`Contract deployed: ${contractId}`);

    // 3. Verify (on-chain bytecode matches local build)
    const verification = verifyDeployment(contractId, network, wasm);
    summary.verification = verification;
    if (!verification.passed) {
      throw new Error(
        `Verification failed: deployed bytecode does not match local build (${
          verification.error ?? 'hash mismatch'
        })`
      );
    }
    log('Verification passed: on-chain bytecode matches local build');

    // 4. Health check (contract is callable and responding correctly)
    const healthResult = runCapture(
      `stellar contract invoke --id ${contractId} --network ${network} -- get_invoice --invoice_id 1`
    );
    const health = classifyHealthCheckResult(healthResult);
    summary.healthCheck = health;
    if (!health.healthy) {
      throw new Error(health.reason);
    }
    log(`Health check passed: ${health.reason}`);

    // 5. Only now wire the new contract ID into the app's runtime config
    updateEnv(contractId, envPath);
    updateReadme(contractId, readmePath);
    log('.env and README.md updated with new contract ID');

    summary.status = 'success';
    summary.finishedAt = new Date().toISOString();
    log('Deployment completed successfully 🎉');
    writeDeploymentSummary(summary, logFilePath);
    activeLogFile = null;
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Deployment failed: ${message}`);

    if (/insufficient/i.test(message)) {
      log('Hint: Fund your account with testnet XLM');
    }
    if (/network/i.test(message)) {
      log('Hint: Check Stellar network connection');
    }

    try {
      log('Rolling back: restoring .env and README.md to pre-deployment state');
      restoreRuntimeFiles(backup, envPath, readmePath);
      summary.rolledBack = true;
      if (summary.contractId) {
        log(
          `Note: contract ${summary.contractId} remains deployed on ${network} but was never wired ` +
            'into the application. It is orphaned and safe to ignore, or clean up manually.'
        );
      }
    } catch (rollbackErr) {
      const rollbackMessage =
        rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      log(
        `Rollback itself failed: ${rollbackMessage}. Manual intervention required - ` +
          `check ${envPath} and ${readmePath} by hand.`
      );
    }

    summary.status = 'rolled_back';
    summary.error = message;
    summary.finishedAt = new Date().toISOString();
    writeDeploymentSummary(summary, logFilePath);
    activeLogFile = null;
    return summary;
  }
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): DeployOptions {
  return {
    network: argv.includes('--network=mainnet') ? 'mainnet' : 'testnet',
    dryRun: argv.includes('--dry-run'),
  };
}

/**
 * Prompt the user to confirm a non-testnet deployment by typing the network name.
 * Exits the process with code 1 if confirmation is not given.
 * Skips the prompt if --yes or --ci is passed, or if --dry-run is active.
 */
export async function confirmNetwork(
  network: string,
  dryRun: boolean,
  argv: string[]
): Promise<void> {
  if (network === 'testnet' || dryRun || argv.includes('--yes') || argv.includes('--ci')) {
    return;
  }

  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(
      `\n⚠️  WARNING: You are about to deploy to "${network}".\n   Type "${network}" to confirm, or press Ctrl-C to abort:\n> `,
      (answer: string) => {
        rl.close();
        if (answer.trim() !== network) {
          console.error('Aborted: network name did not match.');
          process.exit(1);
        }
        resolve();
      }
    );
  });
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);
  confirmNetwork(options.network, options.dryRun, argv).then(() => {
    runDeployment(options).then((summary) => {
      if (summary.status === 'failed' || summary.status === 'rolled_back') {
        process.exitCode = 1;
      }
    });
  });
}
