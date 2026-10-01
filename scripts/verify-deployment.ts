#!/usr/bin/env node

/**
 * Post-deployment verification script for the Invoice Liquidity Network.
 * Runs health checks, contract interaction tests, API endpoint tests,
 * database connectivity tests, and generates a full verification report.
 */

import fs from 'fs';
import path from 'path';
import { runCapture, hashFile, getWasmFile, log } from './deploy';

// ── Types ──────────────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface VerificationReport {
  contractId: string;
  network: string;
  runAt: string;
  overallStatus: 'pass' | 'fail';
  durationMs: number;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  reportFile?: string;
}

export interface VerificationOptions {
  contractId: string;
  network: string;
  rpcUrl?: string;
  apiBaseUrl?: string;
  databaseUrl?: string;
  wasmDir?: string;
  reportDir?: string;
  reportFile?: string;
  skipApi?: boolean;
  skipDatabase?: boolean;
}

// ── Timer helper ───────────────────────────────────────────────────────────

function timed<T>(fn: () => T): { result: T; durationMs: number } {
  const start = Date.now();
  const result = fn();
  return { result, durationMs: Date.now() - start };
}

async function timedAsync<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

// ── Individual checks ──────────────────────────────────────────────────────

/**
 * Verifies the deployed contract bytecode matches the local WASM build artifact.
 */
export async function checkBytecodeMatch(
  contractId: string,
  network: string,
  wasmDir: string
): Promise<CheckResult> {
  const name = 'Bytecode Match';
  const start = Date.now();

  try {
    const wasmPath = getWasmFile(wasmDir);
    const localHash = hashFile(wasmPath);

    const tmpPath = path.join(process.env['TMPDIR'] ?? '/tmp', `iln-verify-${contractId}.wasm`);

    const fetchResult = runCapture(
      `stellar contract fetch --id ${contractId} --network ${network} --out-file ${tmpPath}`
    );

    if (fetchResult.code !== 0) {
      return {
        name,
        status: 'fail',
        message: `Failed to fetch on-chain bytecode: ${fetchResult.stderr || fetchResult.stdout}`,
        durationMs: Date.now() - start,
      };
    }

    if (!fs.existsSync(tmpPath)) {
      return {
        name,
        status: 'fail',
        message: 'contract fetch completed but produced no output file',
        durationMs: Date.now() - start,
      };
    }

    const remoteHash = hashFile(tmpPath);
    fs.unlinkSync(tmpPath);

    const match = localHash === remoteHash;
    return {
      name,
      status: match ? 'pass' : 'fail',
      message: match
        ? 'On-chain bytecode matches local build artifact'
        : `Hash mismatch — local: ${localHash}, remote: ${remoteHash}`,
      durationMs: Date.now() - start,
      details: { localHash, remoteHash },
    };
  } catch (err) {
    return {
      name,
      status: 'fail',
      message: `Bytecode check threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Calls the contract's `get_invoice` method to confirm the contract is live
 * and responding with defined contract-level errors (expected on a fresh deploy).
 */
export async function checkContractLiveness(
  contractId: string,
  network: string
): Promise<CheckResult> {
  const name = 'Contract Liveness';
  const start = Date.now();

  const result = runCapture(
    `stellar contract invoke --id ${contractId} --network ${network} -- get_invoice --invoice_id 1`
  );

  const output = `${result.stdout}\n${result.stderr}`;

  // A contract-level error means the contract is alive and enforcing its own logic.
  const contractLevelError = /Error\(Contract,\s*#?\d+\)|InvoiceNotFound|HostError.*Contract/i.test(
    output
  );

  if (result.code === 0 || contractLevelError) {
    return {
      name,
      status: 'pass',
      message: contractLevelError
        ? 'Contract responded with a defined contract-level error (expected for a fresh deploy)'
        : 'Contract returned successfully',
      durationMs: Date.now() - start,
    };
  }

  return {
    name,
    status: 'fail',
    message: `Contract did not respond as expected: ${
      result.stderr || result.stdout || 'no output'
    }`,
    durationMs: Date.now() - start,
  };
}

/**
 * Verifies the Stellar RPC API endpoint is reachable and responding.
 */
export async function checkApiEndpoint(rpcUrl: string): Promise<CheckResult> {
  const name = 'API Endpoint';
  const start = Date.now();

  const result = runCapture(`curl -sf --max-time 10 "${rpcUrl}" -o /dev/null -w "%{http_code}"`);

  if (result.code === 0) {
    const code = result.stdout.trim();
    const ok = ['200', '400', '401', '405'].includes(code);
    return {
      name,
      status: ok ? 'pass' : 'fail',
      message: ok
        ? `RPC endpoint reachable (HTTP ${code})`
        : `RPC endpoint returned unexpected status: HTTP ${code}`,
      durationMs: Date.now() - start,
      details: { url: rpcUrl, httpStatus: code },
    };
  }

  return {
    name,
    status: 'fail',
    message: `RPC endpoint unreachable: ${result.stderr || 'curl failed'}`,
    durationMs: Date.now() - start,
    details: { url: rpcUrl },
  };
}

/**
 * Verifies that the Stellar Horizon API (or a generic database/backend endpoint)
 * is reachable and responding correctly.
 */
export async function checkDatabaseConnectivity(databaseUrl: string): Promise<CheckResult> {
  const name = 'Database Connectivity';
  const start = Date.now();

  const result = runCapture(
    `curl -sf --max-time 10 "${databaseUrl}" -o /dev/null -w "%{http_code}"`
  );

  if (result.code === 0) {
    const code = result.stdout.trim();
    const ok = parseInt(code, 10) < 500;
    return {
      name,
      status: ok ? 'pass' : 'fail',
      message: ok
        ? `Database/backend endpoint reachable (HTTP ${code})`
        : `Database/backend endpoint returned server error: HTTP ${code}`,
      durationMs: Date.now() - start,
      details: { url: databaseUrl, httpStatus: code },
    };
  }

  return {
    name,
    status: 'fail',
    message: `Database/backend endpoint unreachable: ${result.stderr || 'curl failed'}`,
    durationMs: Date.now() - start,
    details: { url: databaseUrl },
  };
}

/**
 * Checks that the Stellar CLI toolchain is available and reports its version.
 */
export function checkToolchain(): CheckResult {
  const name = 'Toolchain';
  const start = Date.now();

  const { result, durationMs } = timed(() => runCapture('stellar --version'));

  if (result.code === 0) {
    return {
      name,
      status: 'pass',
      message: `stellar CLI found: ${result.stdout.trim()}`,
      durationMs,
    };
  }

  return {
    name,
    status: 'fail',
    message: 'stellar CLI not found or not working',
    durationMs,
  };
}

// ── Report ─────────────────────────────────────────────────────────────────

export function buildReport(
  opts: Pick<VerificationOptions, 'contractId' | 'network' | 'reportDir' | 'reportFile'>,
  checks: CheckResult[],
  durationMs: number
): VerificationReport {
  const passed = checks.filter((c) => c.status === 'pass').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const skipped = checks.filter((c) => c.status === 'skip').length;

  const report: VerificationReport = {
    contractId: opts.contractId,
    network: opts.network,
    runAt: new Date().toISOString(),
    overallStatus: failed > 0 ? 'fail' : 'pass',
    durationMs,
    checks,
    summary: {
      total: checks.length,
      passed,
      failed,
      skipped,
    },
  };

  const reportDir = opts.reportDir ?? 'deploy-logs';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFile =
    opts.reportFile ?? path.join(reportDir, `verification-${opts.network}-${timestamp}.json`);

  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  report.reportFile = reportFile;

  return report;
}

export function printReport(report: VerificationReport): void {
  const statusIcon = (s: CheckStatus) => (s === 'pass' ? '✓' : s === 'fail' ? '✗' : '—');

  log(`\n=== Deployment Verification Report ===`);
  log(`Contract : ${report.contractId}`);
  log(`Network  : ${report.network}`);
  log(`Run at   : ${report.runAt}`);
  log(`Duration : ${report.durationMs}ms`);
  log(`Status   : ${report.overallStatus.toUpperCase()}`);
  log(`\nChecks:`);

  for (const check of report.checks) {
    log(`  ${statusIcon(check.status)} ${check.name.padEnd(28)} ${check.message}`);
  }

  log(
    `\nSummary: ${report.summary.passed} passed, ${report.summary.failed} failed, ` +
      `${report.summary.skipped} skipped (${report.summary.total} total)`
  );

  if (report.reportFile) {
    log(`Report   : ${report.reportFile}`);
  }
}

// ── Orchestrator ───────────────────────────────────────────────────────────

export async function runVerification(options: VerificationOptions): Promise<VerificationReport> {
  const {
    contractId,
    network,
    rpcUrl,
    apiBaseUrl,
    databaseUrl,
    wasmDir = 'target/wasm32v1-none/release',
    skipApi = false,
    skipDatabase = false,
  } = options;

  log(`Running post-deployment verification for contract ${contractId} on ${network}`);

  const overallStart = Date.now();
  const checks: CheckResult[] = [];

  // 1. Toolchain
  checks.push(checkToolchain());

  // 2. Bytecode match
  checks.push(await checkBytecodeMatch(contractId, network, wasmDir));

  // 3. Contract liveness
  checks.push(await checkContractLiveness(contractId, network));

  // 4. API endpoint
  if (skipApi || !rpcUrl) {
    checks.push({
      name: 'API Endpoint',
      status: 'skip',
      message: skipApi ? 'Skipped via --skip-api flag' : 'No --rpc-url provided',
      durationMs: 0,
    });
  } else {
    checks.push(await checkApiEndpoint(apiBaseUrl ?? rpcUrl));
  }

  // 5. Database connectivity
  if (skipDatabase || !databaseUrl) {
    checks.push({
      name: 'Database Connectivity',
      status: 'skip',
      message: skipDatabase ? 'Skipped via --skip-database flag' : 'No --database-url provided',
      durationMs: 0,
    });
  } else {
    checks.push(await checkDatabaseConnectivity(databaseUrl));
  }

  const durationMs = Date.now() - overallStart;
  const report = buildReport(options, checks, durationMs);

  printReport(report);

  return report;
}

// ── Recovery hints ─────────────────────────────────────────────────────────

export function printRecoveryHints(report: VerificationReport): void {
  const failed = report.checks.filter((c) => c.status === 'fail');
  if (failed.length === 0) return;

  log('\nRecovery options:');
  for (const check of failed) {
    switch (check.name) {
      case 'Bytecode Match':
        log('  • Bytecode mismatch: redeploy with `pnpm ts-node scripts/deploy.ts`');
        break;
      case 'Contract Liveness':
        log('  • Contract not responding: verify the contract ID and network are correct');
        log('    Run: stellar contract invoke --id <id> --network <net> -- get_version');
        break;
      case 'API Endpoint':
        log('  • API unreachable: check the RPC URL and network connectivity');
        log('    Testnet RPC: https://soroban-testnet.stellar.org');
        break;
      case 'Database Connectivity':
        log('  • Backend unreachable: check the database URL and service health');
        break;
      case 'Toolchain':
        log('  • stellar CLI missing: install via `cargo install stellar-cli`');
        break;
    }
  }
}

// ── CLI entrypoint ─────────────────────────────────────────────────────────

function parseVerifyArgs(argv: string[]): VerificationOptions {
  const get = (flag: string) => {
    const idx = argv.findIndex((a) => a.startsWith(`${flag}=`) || a === flag);
    if (idx === -1) return undefined;
    if (argv[idx]?.includes('=')) return argv[idx]?.split('=')[1];
    return argv[idx + 1];
  };

  const contractId = get('--contract-id') ?? get('--id');
  if (!contractId) {
    throw new Error('Missing required flag: --contract-id <id>');
  }

  return {
    contractId,
    network: get('--network') ?? 'testnet',
    rpcUrl: get('--rpc-url'),
    apiBaseUrl: get('--api-url'),
    databaseUrl: get('--database-url'),
    wasmDir: get('--wasm-dir'),
    reportDir: get('--report-dir'),
    reportFile: get('--report-file'),
    skipApi: argv.includes('--skip-api'),
    skipDatabase: argv.includes('--skip-database'),
  };
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  (async () => {
    try {
      const options = parseVerifyArgs(process.argv.slice(2));
      const report = await runVerification(options);
      printRecoveryHints(report);
      process.exitCode = report.overallStatus === 'pass' ? 0 : 1;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  })();
}
