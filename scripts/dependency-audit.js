#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const reportDir = path.join(repoRoot, '.security');

function getSeverity() {
  return process.env.SECURITY_AUDIT_LEVEL || 'high';
}

function getNpmAuditRoots(root) {
  const base = root || repoRoot;
  return [
    'cli',
    'sdk',
    'indexer',
    'notifications',
    'packages/indexer',
    'packages/mock-backend',
    'packages/sdk'
  ].filter((dir) => fs.existsSync(path.join(base, dir, 'package-lock.json')));
}

function usage() {
  console.log(`Usage: node scripts/dependency-audit.js <audit|snyk|licenses|scan|report> [--fix]

Commands:
  audit      Run dependency audits across the pnpm workspace and npm projects.
  snyk       Run Snyk across all detected projects.
  licenses   Run the license compliance checker.
  scan       Run npm audit, license compliance, and Snyk.
  report     Generate vulnerability and license reports in .security/.

Options:
  --fix      With audit, run npm audit fix for package-lock based projects.

Environment:
  SECURITY_AUDIT_LEVEL  npm/Snyk severity threshold. Defaults to high.`);
}

function toReportName(label) {
  return label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function runCommand(command, args, options = {}) {
  const spawn = options._spawnSync || spawnSync;
  const cwd = options.cwd || repoRoot;

  const result = spawn(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });

  let output = `${result.stdout || ''}${result.stderr || ''}`;

  if (result.error) {
    output = `${output}${output ? '\n' : ''}${result.error.message}`;
  }

  if (options.reportPath) {
    fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
    fs.writeFileSync(options.reportPath, output || `Command exited with status ${result.status}\n`);
  } else if (output) {
    process.stdout.write(output);
  }

  if (result.error) {
    return {
      ok: false,
      status: 1,
      output
    };
  }

  return {
    ok: result.status === 0,
    status: result.status || 0,
    output
  };
}

function ensureReportDir(dir) {
  fs.mkdirSync(dir || reportDir, { recursive: true });
}

function runNpmAudit({ fix = false, report = false, _deps = {} } = {}) {
  const severity = _deps.severity || getSeverity();
  const roots = _deps.npmAuditRoots != null ? _deps.npmAuditRoots : getNpmAuditRoots(_deps.repoRoot);
  const run = _deps.runCommand || runCommand;

  if (roots.length === 0) {
    console.log('No package-lock.json files found for npm audit.');
    return true;
  }

  let ok = true;
  const summary = [];

  for (const relativeDir of roots) {
    const cwd = path.join(_deps.repoRoot || repoRoot, relativeDir);
    const label = relativeDir;
    const args = fix
      ? ['audit', 'fix', '--omit=dev']
      : ['audit', '--omit=dev', `--audit-level=${severity}`];

    if (report && !fix) {
      args.push('--json');
    }

    console.log(`\nRunning npm ${args.join(' ')} in ${label}`);
    const reportDirPath = _deps.reportDir || reportDir;
    const reportPath = report && !fix
      ? path.join(reportDirPath, `npm-audit-${toReportName(label)}.json`)
      : undefined;
    const result = run('npm', args, { cwd, reportPath, _spawnSync: _deps._spawnSync });

    summary.push({
      project: label,
      command: `npm ${args.join(' ')}`,
      status: result.status,
      report: reportPath ? path.relative(_deps.repoRoot || repoRoot, reportPath) : undefined
    });

    if (!result.ok) {
      ok = false;
      console.error(`npm audit failed for ${label} with status ${result.status}.`);
    }
  }

  if (report) {
    const reportDirPath = _deps.reportDir || reportDir;
    fs.writeFileSync(
      path.join(reportDirPath, 'npm-audit-summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`
    );
  }

  return ok;
}

function runPnpmAudit({ report = false, _deps = {} } = {}) {
  const severity = _deps.severity || getSeverity();
  const run = _deps.runCommand || runCommand;
  const base = _deps.repoRoot || repoRoot;

  if (!fs.existsSync(path.join(base, 'pnpm-lock.yaml'))) {
    return true;
  }

  const args = ['audit', '--prod', `--audit-level=${severity}`];

  if (report) {
    args.push('--json');
  }

  console.log('\nRunning pnpm workspace audit');
  const reportDirPath = _deps.reportDir || reportDir;
  const result = run('pnpm', args, {
    reportPath: report ? path.join(reportDirPath, 'pnpm-audit-workspace.json') : undefined,
    _spawnSync: _deps._spawnSync
  });

  if (!result.ok) {
    console.error(`pnpm workspace audit failed with status ${result.status}.`);
  }

  return result.ok;
}

function runSnyk({ report = false, _deps = {} } = {}) {
  const severity = _deps.severity || getSeverity();
  const run = _deps.runCommand || runCommand;
  const args = ['--yes', 'snyk', 'test', '--all-projects', `--severity-threshold=${severity}`];

  if (report) {
    args.push('--json');
  }

  console.log('\nRunning Snyk dependency scan');
  const reportDirPath = _deps.reportDir || reportDir;
  const result = run('npx', args, {
    reportPath: report ? path.join(reportDirPath, 'snyk-report.json') : undefined,
    _spawnSync: _deps._spawnSync
  });

  if (!result.ok) {
    console.error(`Snyk scan failed with status ${result.status}.`);
  }

  return result.ok;
}

function runLicenses({ report = false, _deps = {} } = {}) {
  const run = _deps.runCommand || runCommand;
  console.log('\nRunning license compliance check');
  const reportDirPath = _deps.reportDir || reportDir;
  const result = run('node', ['scripts/check-licenses.js'], {
    reportPath: report ? path.join(reportDirPath, 'license-report.txt') : undefined,
    _spawnSync: _deps._spawnSync
  });

  if (!result.ok) {
    console.error(`License compliance check failed with status ${result.status}.`);
  }

  return result.ok;
}

function runScan({ report = false, _deps = {} } = {}) {
  if (report) {
    ensureReportDir(_deps.reportDir || reportDir);
  }

  const pnpmAuditOk = runPnpmAudit({ report, _deps });
  const npmAuditOk = runNpmAudit({ report, _deps });
  const auditOk = pnpmAuditOk && npmAuditOk;
  const licensesOk = runLicenses({ report, _deps });
  const snykOk = runSnyk({ report, _deps });

  return auditOk && licensesOk && snykOk;
}

function main() {
  const [, , command, ...flags] = process.argv;
  const fix = flags.includes('--fix');

  if (!command || command === '--help' || command === '-h' || flags.includes('--help') || flags.includes('-h')) {
    usage();
    process.exit(command ? 0 : 1);
  }

  let ok;

  switch (command) {
    case 'audit':
      if (fix) {
        ok = runNpmAudit({ fix });
      } else {
        const pnpmAuditOk = runPnpmAudit();
        const npmAuditOk = runNpmAudit();
        ok = pnpmAuditOk && npmAuditOk;
      }
      break;
    case 'snyk':
      ok = runSnyk();
      break;
    case 'licenses':
      ok = runLicenses();
      break;
    case 'scan':
      ok = runScan();
      break;
    case 'report':
      ok = runScan({ report: true });
      console.log(`\nSecurity reports written to ${path.relative(repoRoot, reportDir)}/`);
      break;
    default:
      usage();
      process.exit(1);
  }

  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  toReportName,
  runCommand,
  ensureReportDir,
  runNpmAudit,
  runPnpmAudit,
  runSnyk,
  runLicenses,
  runScan,
  usage,
  getSeverity,
  getNpmAuditRoots,
  repoRoot,
  reportDir
};
