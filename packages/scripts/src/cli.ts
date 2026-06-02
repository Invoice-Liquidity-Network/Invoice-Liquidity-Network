import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

type ILNConfig = Record<string, any>;

function findConfigFile(start = process.cwd()): string | null {
  let cur = start;
  while (true) {
    const candidate = path.join(cur, '.iln.config.ts');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function loadConfig(): ILNConfig {
  const cfgPath = findConfigFile();
  if (!cfgPath) {
    console.warn('No .iln.config.ts found in ancestor directories. Using empty config.');
    return {};
  }
  // require the TypeScript file; ts-node should be registered by the JS wrapper
  // Use require to allow CommonJS loading after ts-node registration.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loaded = require(cfgPath);
  return loaded?.default ?? loaded;
}

async function runDeployTestnet(opts: { force?: boolean }) {
  const cfg = loadConfig();
  console.log('Running deploy-testnet with config from .iln.config.ts');
  // Example behaviour: show what would be deployed
  const testnet = cfg.testnet ?? {};
  console.log('Testnet config:', JSON.stringify(testnet, null, 2));
  // Placeholder: real deploy logic should go here (e.g., call Hardhat/Foundry scripts)
  console.log('Deploying contracts to testnet (simulated)...');
  if (opts.force) console.log('Force deploy enabled.');
  // Simulate some work
  await new Promise((r) => setTimeout(r, 500));
  console.log('Deployment complete (simulated).');
}

async function runSmokeTest(opts: { timeout?: number }) {
  const cfg = loadConfig();
  console.log('Running smoke-test using .iln.config.ts');
  const contractIds = cfg.contractIds ?? cfg.contracts ?? {};
  console.log('Known contract IDs:', Object.keys(contractIds).length ? contractIds : '(none)');

  // Example smoke checks: verify contract id strings exist
  const missing = Object.entries(contractIds || {}).filter(([, v]) => !v);
  if (missing.length) {
    console.error('Smoke test failed: some contract IDs are missing', missing.map(([k]) => k));
    process.exitCode = 2;
    return;
  }

  // Optionally run repo-local smoke script if present
  const repoSmoke = path.join(process.cwd(), 'scripts', 'smoke-test.sh');
  if (fs.existsSync(repoSmoke)) {
    console.log('Found repo smoke-test script, executing...');
    const res = spawnSync('sh', [repoSmoke], { stdio: 'inherit' });
    if (res.status !== 0) process.exitCode = res.status ?? 1;
    return;
  }

  console.log('Smoke checks passed (basic validations).');
}

async function runGenerateTypes() {
  console.log('generate-types: delegating to repository generator if present.');
  const script = path.join(process.cwd(), 'scripts', 'generate-types.ts');
  if (fs.existsSync(script)) {
    console.log('Found scripts/generate-types.ts — running with ts-node');
    const res = spawnSync('node', [script], { stdio: 'inherit' });
    if (res.status !== 0) process.exitCode = res.status ?? 1;
    return;
  }
  console.log('No repository generator found at scripts/generate-types.ts');
}

async function runGetContractIds() {
  const cfg = loadConfig();
  const contractIds = cfg.contractIds ?? cfg.contracts ?? {};
  console.log('Contract IDs:');
  console.log(JSON.stringify(contractIds, null, 2));
}

const program = new Command();
program.name('iln').description('ILN shared developer CLI').version('0.1.0');

program
  .command('deploy-testnet')
  .description('Deploy contracts to a testnet (placeholder implementation)')
  .option('-f, --force', 'force deployment')
  .action(async (opts) => {
    try {
      await runDeployTestnet(opts);
    } catch (e) {
      console.error('Error during deploy-testnet:', e);
      process.exit(1);
    }
  });

program
  .command('smoke-test')
  .description('Run basic smoke tests against current repo configuration')
  .option('-t, --timeout <ms>', 'timeout in ms', (v) => parseInt(v, 10), 30000)
  .action(async (opts) => {
    try {
      await runSmokeTest(opts);
    } catch (e) {
      console.error('Error during smoke-test:', e);
      process.exit(1);
    }
  });

program
  .command('generate-types')
  .description('Generate TypeScript types (delegates to repo script if present)')
  .action(async () => {
    try {
      await runGenerateTypes();
    } catch (e) {
      console.error('Error during generate-types:', e);
      process.exit(1);
    }
  });

program
  .command('get-contract-ids')
  .description('Print contract IDs from .iln.config.ts')
  .action(async () => {
    try {
      await runGetContractIds();
    } catch (e) {
      console.error('Error during get-contract-ids:', e);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
