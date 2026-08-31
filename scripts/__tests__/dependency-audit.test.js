import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  toReportName,
  runCommand,
  runNpmAudit,
  runPnpmAudit,
  runSnyk,
  runLicenses,
  runScan,
  getSeverity,
  getNpmAuditRoots,
} = require('../dependency-audit.js');

function makeSpawnResult({ status = 0, stdout = '', stderr = '', error = null } = {}) {
  return { status, stdout, stderr, error };
}

function fakeSpawnSync(results) {
  let callIndex = 0;
  return (...args) => {
    const result = results[callIndex] || results[results.length - 1];
    callIndex++;
    if (typeof result === 'function') return result(...args);
    return result;
  };
}

describe('toReportName', () => {
  it('converts a label to a kebab-case report name', () => {
    assert.equal(toReportName('cli'), 'cli');
    assert.equal(toReportName('packages/mock-backend'), 'packages-mock-backend');
    assert.equal(toReportName('My  Project!!'), 'my-project');
  });

  it('strips leading and trailing hyphens', () => {
    assert.equal(toReportName('--foo--'), 'foo');
    assert.equal(toReportName('__bar__'), 'bar');
  });

  it('handles empty and special-character-only strings', () => {
    assert.equal(toReportName(''), '');
    assert.equal(toReportName('---'), '');
    assert.equal(toReportName('!!!'), '');
  });
});

describe('getSeverity', () => {
  const originalEnv = process.env.SECURITY_AUDIT_LEVEL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SECURITY_AUDIT_LEVEL;
    } else {
      process.env.SECURITY_AUDIT_LEVEL = originalEnv;
    }
  });

  it('defaults to high', () => {
    delete process.env.SECURITY_AUDIT_LEVEL;
    assert.equal(getSeverity(), 'high');
  });

  it('uses SECURITY_AUDIT_LEVEL when set', () => {
    process.env.SECURITY_AUDIT_LEVEL = 'critical';
    assert.equal(getSeverity(), 'critical');
  });
});

describe('getNpmAuditRoots', () => {
  it('returns directories that have package-lock.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
    fs.mkdirSync(path.join(tmpDir, 'cli'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'cli', 'package-lock.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, 'sdk'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'sdk', 'package-lock.json'), '{}');

    const roots = getNpmAuditRoots(tmpDir);
    assert.ok(roots.includes('cli'));
    assert.ok(roots.includes('sdk'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('excludes directories without package-lock.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
    fs.mkdirSync(path.join(tmpDir, 'cli'), { recursive: true });
    // no package-lock.json in cli/
    const roots = getNpmAuditRoots(tmpDir);
    assert.ok(!roots.includes('cli'));
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('runCommand', () => {
  it('calls spawnSync with correct arguments', () => {
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0, stdout: 'ok\n' }));
    runCommand('npm', ['audit'], { _spawnSync: spawn });
    assert.equal(spawn.mock.callCount(), 1);
    const [cmd, args, opts] = spawn.mock.calls[0].arguments;
    assert.equal(cmd, 'npm');
    assert.deepEqual(args, ['audit']);
    assert.equal(opts.encoding, 'utf8');
  });

  it('returns ok:true when exit code is 0', () => {
    const spawn = mock.fn(() => makeSpawnResult({ status: 0, stdout: 'clean\n' }));
    const result = runCommand('ls', [], { _spawnSync: spawn });
    assert.equal(result.ok, true);
    assert.equal(result.status, 0);
    assert.equal(result.output, 'clean\n');
  });

  it('returns ok:false when exit code is non-zero', () => {
    const spawn = mock.fn(() => makeSpawnResult({ status: 1, stderr: 'vuln found\n' }));
    const result = runCommand('npm', ['audit'], { _spawnSync: spawn });
    assert.equal(result.ok, false);
    assert.equal(result.status, 1);
  });

  it('handles spawn error (missing tool)', () => {
    const spawn = mock.fn(() =>
      makeSpawnResult({
        status: null,
        error: { message: 'ENOENT: spawn snyk' },
      })
    );
    const result = runCommand('snyk', ['test'], { _spawnSync: spawn });
    assert.equal(result.ok, false);
    assert.equal(result.status, 1);
    assert.match(result.output, /ENOENT/);
  });

  it('combines stdout and stderr into output', () => {
    const spawn = mock.fn(() => makeSpawnResult({ status: 0, stdout: 'out', stderr: 'err' }));
    const result = runCommand('cmd', [], { _spawnSync: spawn });
    assert.equal(result.output, 'outerr');
  });

  it('writes to reportPath when provided', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-test-'));
    const reportPath = path.join(tmpDir, 'report.txt');
    const spawn = mock.fn(() => makeSpawnResult({ status: 0, stdout: 'data' }));
    runCommand('cmd', [], { _spawnSync: spawn, reportPath });
    const content = fs.readFileSync(reportPath, 'utf8');
    assert.equal(content, 'data');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('runNpmAudit', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-audit-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns true immediately when no npmAuditRoots are provided', () => {
    const result = runNpmAudit({ _deps: { npmAuditRoots: [] } });
    assert.equal(result, true);
  });

  it('runs npm audit for each root with correct args', () => {
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runNpmAudit({
      _deps: {
        npmAuditRoots: ['cli', 'sdk'],
        repoRoot: tmpDir,
        runCommand: (cmd, args, opts) => {
          calls.push({ cmd, args });
          return runCommand(cmd, args, { ...opts, _spawnSync: spawn });
        },
        _spawnSync: spawn,
      },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args.slice(0, 3), ['audit', '--omit=dev', '--audit-level=high']);
    assert.deepEqual(calls[1].args.slice(0, 3), ['audit', '--omit=dev', '--audit-level=high']);
  });

  it('returns false when a root audit fails', () => {
    const spawn = mock.fn(() => makeSpawnResult({ status: 1 }));
    const result = runNpmAudit({
      _deps: {
        npmAuditRoots: ['cli'],
        repoRoot: tmpDir,
        runCommand: (cmd, args, opts) => runCommand(cmd, args, { ...opts, _spawnSync: spawn }),
        _spawnSync: spawn,
      },
    });
    assert.equal(result, false);
  });

  it('uses --audit-level from custom severity', () => {
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runNpmAudit({
      _deps: {
        npmAuditRoots: ['cli'],
        repoRoot: tmpDir,
        severity: 'critical',
        runCommand: (cmd, args, opts) => {
          calls.push({ cmd, args });
          return runCommand(cmd, args, { ...opts, _spawnSync: spawn });
        },
        _spawnSync: spawn,
      },
    });
    assert.ok(calls[0].args.some((a) => a.includes('critical')));
  });

  it('passes --json when report mode is on (non-fix)', () => {
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runNpmAudit({
      report: true,
      _deps: {
        npmAuditRoots: ['cli'],
        repoRoot: tmpDir,
        runCommand: (cmd, args, opts) => {
          calls.push({ cmd, args });
          return runCommand(cmd, args, { ...opts, _spawnSync: spawn });
        },
        _spawnSync: spawn,
      },
    });
    assert.ok(calls[0].args.includes('--json'));
  });

  it('uses fix args when fix mode is on', () => {
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runNpmAudit({
      fix: true,
      _deps: {
        npmAuditRoots: ['cli'],
        repoRoot: tmpDir,
        runCommand: (cmd, args, opts) => {
          calls.push({ cmd, args });
          return runCommand(cmd, args, { ...opts, _spawnSync: spawn });
        },
        _spawnSync: spawn,
      },
    });
    assert.deepEqual(calls[0].args, ['audit', 'fix', '--omit=dev']);
  });

  it('reports error status per root on failure', () => {
    const spawn = mock.fn(() => makeSpawnResult({ status: 1, stderr: 'err' }));
    const logs = [];
    const origError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    try {
      const result = runNpmAudit({
        _deps: {
          npmAuditRoots: ['cli'],
          repoRoot: tmpDir,
          runCommand: (cmd, args, opts) => runCommand(cmd, args, { ...opts, _spawnSync: spawn }),
          _spawnSync: spawn,
        },
      });
      assert.equal(result, false);
      assert.ok(logs.some((l) => l.includes('npm audit failed')));
    } finally {
      console.error = origError;
    }
  });
});

describe('runPnpmAudit', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm-audit-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns true when pnpm-lock.yaml is absent', () => {
    const result = runPnpmAudit({ _deps: { repoRoot: tmpDir } });
    assert.equal(result, true);
  });

  it('runs pnpm audit when pnpm-lock.yaml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runPnpmAudit({
      _deps: {
        repoRoot: tmpDir,
        runCommand: (cmd, args, opts) => {
          calls.push({ cmd, args });
          return runCommand(cmd, args, { ...opts, _spawnSync: spawn });
        },
        _spawnSync: spawn,
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'pnpm');
    assert.ok(calls[0].args.includes('audit'));
    assert.ok(calls[0].args.includes('--prod'));
  });

  it('returns false on pnpm audit failure', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const spawn = mock.fn(() => makeSpawnResult({ status: 1 }));
    const result = runPnpmAudit({
      _deps: {
        repoRoot: tmpDir,
        runCommand: (cmd, args, opts) => runCommand(cmd, args, { ...opts, _spawnSync: spawn }),
        _spawnSync: spawn,
      },
    });
    assert.equal(result, false);
  });

  it('appends --json when report mode is on', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runPnpmAudit({
      report: true,
      _deps: {
        repoRoot: tmpDir,
        runCommand: (cmd, args, opts) => {
          calls.push({ cmd, args });
          return runCommand(cmd, args, { ...opts, _spawnSync: spawn });
        },
        _spawnSync: spawn,
      },
    });
    assert.ok(calls[0].args.includes('--json'));
  });
});

describe('runSnyk', () => {
  it('calls npx with snyk test args', () => {
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runSnyk({
      _deps: {
        runCommand: (cmd, args, opts) => {
          calls.push({ cmd, args });
          return runCommand(cmd, args, { ...opts, _spawnSync: spawn });
        },
        _spawnSync: spawn,
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'npx');
    assert.ok(calls[0].args.includes('snyk'));
    assert.ok(calls[0].args.includes('test'));
    assert.ok(calls[0].args.includes('--all-projects'));
  });

  it('returns false on Snyk failure', () => {
    const spawn = mock.fn(() => makeSpawnResult({ status: 1 }));
    const result = runSnyk({
      _deps: {
        runCommand: (cmd, args, opts) => runCommand(cmd, args, { ...opts, _spawnSync: spawn }),
        _spawnSync: spawn,
      },
    });
    assert.equal(result, false);
  });

  it('passes --json in report mode', () => {
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runSnyk({
      report: true,
      _deps: {
        runCommand: (cmd, args, opts) => {
          calls.push({ cmd, args });
          return runCommand(cmd, args, { ...opts, _spawnSync: spawn });
        },
        _spawnSync: spawn,
      },
    });
    assert.ok(calls[0].args.includes('--json'));
  });

  it('uses custom severity threshold', () => {
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runSnyk({
      _deps: {
        severity: 'medium',
        runCommand: (cmd, args, opts) => {
          calls.push({ cmd, args });
          return runCommand(cmd, args, { ...opts, _spawnSync: spawn });
        },
        _spawnSync: spawn,
      },
    });
    assert.ok(calls[0].args.some((a) => a.includes('medium')));
  });

  it('handles Snyk not installed (spawn error)', () => {
    const spawn = mock.fn(() =>
      makeSpawnResult({
        status: null,
        error: { message: 'ENOENT: npx snyk' },
      })
    );
    const result = runSnyk({
      _deps: {
        runCommand: (cmd, args, opts) => runCommand(cmd, args, { ...opts, _spawnSync: spawn }),
        _spawnSync: spawn,
      },
    });
    assert.equal(result, false);
  });
});

describe('runLicenses', () => {
  it('calls node scripts/check-licenses.js', () => {
    const calls = [];
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runLicenses({
      _deps: {
        runCommand: (cmd, args, opts) => {
          calls.push({ cmd, args });
          return runCommand(cmd, args, { ...opts, _spawnSync: spawn });
        },
        _spawnSync: spawn,
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'node');
    assert.deepEqual(calls[0].args, ['scripts/check-licenses.js']);
  });

  it('returns false on license check failure', () => {
    const spawn = mock.fn(() => makeSpawnResult({ status: 1 }));
    const result = runLicenses({
      _deps: {
        runCommand: (cmd, args, opts) => runCommand(cmd, args, { ...opts, _spawnSync: spawn }),
        _spawnSync: spawn,
      },
    });
    assert.equal(result, false);
  });

  it('handles missing check-licenses.js script', () => {
    const spawn = mock.fn(() =>
      makeSpawnResult({
        status: null,
        error: { message: 'ENOENT: node scripts/check-licenses.js' },
      })
    );
    const result = runLicenses({
      _deps: {
        runCommand: (cmd, args, opts) => runCommand(cmd, args, { ...opts, _spawnSync: spawn }),
        _spawnSync: spawn,
      },
    });
    assert.equal(result, false);
  });
});

describe('runScan', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns true when all sub-scans succeed', () => {
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    const fakeRun = (cmd, args, opts) => runCommand(cmd, args, { ...opts, _spawnSync: spawn });
    const result = runScan({
      _deps: {
        repoRoot: tmpDir,
        reportDir: tmpDir,
        npmAuditRoots: [],
        runCommand: fakeRun,
        _spawnSync: spawn,
      },
    });
    assert.equal(result, true);
  });

  it('returns false when any sub-scan fails', () => {
    let callCount = 0;
    const fakeRun = (cmd, args, opts) => {
      callCount++;
      // Fail on the third call (npm audit after pnpm audit succeeds)
      if (cmd === 'npm') return { ok: false, status: 1, output: 'vuln' };
      return { ok: true, status: 0, output: '' };
    };
    const result = runScan({
      _deps: {
        repoRoot: tmpDir,
        reportDir: tmpDir,
        npmAuditRoots: ['cli'],
        runCommand: fakeRun,
        _spawnSync: () => makeSpawnResult(),
      },
    });
    assert.equal(result, false);
  });

  it('creates report dir in report mode', () => {
    const reportDir = path.join(tmpDir, 'reports');
    const spawn = mock.fn(() => makeSpawnResult({ status: 0 }));
    runScan({
      report: true,
      _deps: {
        repoRoot: tmpDir,
        reportDir,
        npmAuditRoots: [],
        runCommand: (cmd, args, opts) => runCommand(cmd, args, { ...opts, _spawnSync: spawn }),
        _spawnSync: spawn,
      },
    });
    assert.ok(fs.existsSync(reportDir));
  });
});

describe('runCommand error combinations', () => {
  it('handles malformed output (empty stdout+stderr) gracefully', () => {
    const spawn = mock.fn(() => makeSpawnResult({ status: 0, stdout: '', stderr: '' }));
    const result = runCommand('cmd', [], { _spawnSync: spawn });
    assert.equal(result.ok, true);
    assert.equal(result.output, '');
  });

  it('handles very large output without crashing', () => {
    const bigOutput = 'x'.repeat(1_000_000);
    const spawn = mock.fn(() => makeSpawnResult({ status: 0, stdout: bigOutput }));
    const result = runCommand('cmd', [], { _spawnSync: spawn });
    assert.equal(result.ok, true);
    assert.equal(result.output.length, 1_000_000);
  });

  it('handles null status from spawn (tool not found)', () => {
    const spawn = mock.fn(() =>
      makeSpawnResult({ status: null, error: { message: 'spawn ENOENT' } })
    );
    const result = runCommand('missing-tool', [], { _spawnSync: spawn });
    assert.equal(result.ok, false);
    assert.equal(result.status, 1);
  });
});
