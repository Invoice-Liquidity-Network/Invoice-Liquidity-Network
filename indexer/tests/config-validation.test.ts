import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_EXIT_CODE,
  NUMERIC_RULES,
  configSummary,
  redactUrl,
  reportConfigValidation,
  validateIndexerEnv,
} from '../src/configValidation';
import { AUTO_START_LOOKBACK, resolveStartLedger } from '../src/poller';

/**
 * Startup configuration control (docs/indexer/operations-checks.md).
 *
 * Success, failure, boundary and restart/replay behaviour of the fail-closed
 * validation that runs before the indexer opens its port or polls the RPC node.
 */

const CONTRACT = 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC';
const MAINNET = 'Public Global Stellar Network ; September 2015';
const tmp = mkdtempSync(join(tmpdir(), 'iln-config-'));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A complete, valid production environment. */
function prodEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    CONTRACT_ID: CONTRACT,
    NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    RPC_URL: 'https://soroban-testnet.stellar.org',
    DB_PATH: join(tmp, 'indexer.db'),
    PORT: '3001',
    POLL_INTERVAL_MS: '5000',
    BACKUP_ENABLED: 'true',
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

const errorVars = (env: NodeJS.ProcessEnv) => validateIndexerEnv(env).errors.map((e) => e.variable);

describe('startup config validation — success', () => {
  it('accepts a complete production environment with no warnings', () => {
    const result = validateIndexerEnv(prodEnv());
    expect(result).toMatchObject({ ok: true, errors: [], warnings: [], network: 'testnet' });
  });

  it('accepts the documented development defaults (nothing set) with a CONTRACT_ID warning only', () => {
    const result = validateIndexerEnv({ DB_PATH: join(tmp, 'dev.db') });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.variable)).toEqual(['CONTRACT_ID']);
  });

  it('accepts every documented example value', () => {
    const result = validateIndexerEnv(
      prodEnv({
        NETWORK_PASSPHRASE: MAINNET,
        RPC_URL: 'https://soroban-mainnet.stellar.org',
        POLL_INTERVAL_MS: '3000',
        RATE_LIMIT_MAX: '50',
        RATE_LIMIT_WHITELIST: '10.0.0.1, 10.0.0.2,::1',
        REDIS_URL: 'redis://:secret@localhost:6379',
        SUBSCRIPTION_AUTH_TOKEN: 'a-long-enough-shared-secret',
        SUBSCRIPTION_MAX_CONNECTIONS: '0',
        BACKUP_CLOUD_PROVIDER: 's3',
        BACKUP_CLOUD_BUCKET: 'iln-indexer-backups',
        ARCHIVE_ENABLED: 'false',
      })
    );
    expect(result).toMatchObject({ ok: true, errors: [], network: 'mainnet' });
  });

  it('logs a secret-free OK summary', () => {
    const env = prodEnv({
      REDIS_URL: 'redis://user:hunter2@cache:6379',
      SUBSCRIPTION_AUTH_TOKEN: 'super-secret-token-value',
    });
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(reportConfigValidation(env, validateIndexerEnv(env), logger)).toBe(true);
    const line = logger.log.mock.calls[0][0] as string;
    expect(line).toMatch(/^\[config\] OK network=testnet contract=CD3TE3/);
    expect(line).toContain('subscriptionAuth=set');
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('super-secret-token-value');
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('startup config validation — failure (fail closed)', () => {
  it.each([
    ['POLL_INTERVAL_MS', '5s'],
    ['POLL_INTERVAL_MS', 'abc'],
    ['POLL_INTERVAL_MS', '5e3'],
    ['PORT', '30.5'],
    ['PORT', '-1'],
    ['START_LEDGER', '0x10'],
    ['RATE_LIMIT_MAX', 'unlimited'],
  ])('rejects %s=%s instead of letting Number() turn it into NaN', (name, value) => {
    expect(errorVars(prodEnv({ [name]: value }))).toEqual([name]);
  });

  it('rejects a numeric variable that is set but empty (config.ts would not apply the default)', () => {
    const result = validateIndexerEnv(prodEnv({ PORT: '' }));
    expect(result.errors).toEqual([
      { variable: 'PORT', problem: expect.stringMatching(/set but empty/) },
    ]);
  });

  it('requires CONTRACT_ID in production and validates its checksum', () => {
    expect(errorVars(prodEnv({ CONTRACT_ID: undefined }))).toEqual(['CONTRACT_ID']);
    expect(errorVars(prodEnv({ CONTRACT_ID: 'YOUR_MAINNET_CONTRACT_ID' }))).toEqual([
      'CONTRACT_ID',
    ]);
    // A G… account address is not a contract.
    expect(
      errorVars(prodEnv({ CONTRACT_ID: 'GBSOVFQ4MFEHKV37QXGFKRM66CKFWWU47CRXGAWTP7DQIRMUQK56OPR' }))
    ).toEqual(['CONTRACT_ID']);
    // Correct shape, broken checksum.
    expect(errorVars(prodEnv({ CONTRACT_ID: CONTRACT.slice(0, -1) + 'A' }))).toEqual([
      'CONTRACT_ID',
    ]);
  });

  it('rejects a mainnet passphrase pointed at a testnet RPC node, and the reverse', () => {
    expect(errorVars(prodEnv({ NETWORK_PASSPHRASE: MAINNET }))).toEqual(['RPC_URL']);
    expect(errorVars(prodEnv({ RPC_URL: 'https://soroban-mainnet.stellar.org' }))).toEqual([
      'RPC_URL',
    ]);
  });

  it('rejects boolean spellings the code would silently misread', () => {
    // ARCHIVE_ENABLED !== 'false' → "False" would ENABLE archival.
    expect(errorVars(prodEnv({ ARCHIVE_ENABLED: 'False' }))).toEqual(['ARCHIVE_ENABLED']);
    // BACKUP_ENABLED === 'true' → "TRUE" or "1" would silently DISABLE backups.
    expect(errorVars(prodEnv({ BACKUP_ENABLED: 'TRUE' }))).toEqual(['BACKUP_ENABLED']);
    expect(errorVars(prodEnv({ BACKUP_ENABLED: '1' }))).toEqual(['BACKUP_ENABLED']);
  });

  it('rejects a cloud backup provider without a bucket, and unknown providers', () => {
    expect(errorVars(prodEnv({ BACKUP_CLOUD_PROVIDER: 's3' }))).toEqual(['BACKUP_CLOUD_BUCKET']);
    expect(
      errorVars(prodEnv({ BACKUP_CLOUD_PROVIDER: 'dropbox', BACKUP_CLOUD_BUCKET: 'b' }))
    ).toEqual(['BACKUP_CLOUD_PROVIDER']);
  });

  it('rejects non-IP whitelist entries so they cannot be mistaken for identities', () => {
    expect(errorVars(prodEnv({ RATE_LIMIT_WHITELIST: '10.0.0.1,monitoring-service' }))).toEqual([
      'RATE_LIMIT_WHITELIST',
    ]);
  });

  it('rejects storage that cannot persist the index', () => {
    expect(errorVars(prodEnv({ DB_PATH: ':memory:' }))).toEqual(['DB_PATH']);
    expect(errorVars(prodEnv({ DB_PATH: join(tmp, 'missing-dir', 'indexer.db') }))).toEqual([
      'DB_PATH',
    ]);
  });

  it.skipIf(process.getuid?.() === 0)('rejects a DB_PATH directory that is not writable', () => {
    const ro = join(tmp, 'read-only');
    rmSync(ro, { recursive: true, force: true });
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    expect(errorVars(prodEnv({ DB_PATH: join(ro, 'indexer.db') }))).toEqual(['DB_PATH']);
  });

  it('rejects malformed RPC and Redis URLs', () => {
    expect(errorVars(prodEnv({ RPC_URL: 'soroban-testnet.stellar.org' }))).toEqual(['RPC_URL']);
    expect(errorVars(prodEnv({ RPC_URL: 'ftp://soroban-testnet.stellar.org' }))).toEqual([
      'RPC_URL',
    ]);
    expect(errorVars(prodEnv({ REDIS_URL: 'http://cache:6379' }))).toEqual(['REDIS_URL']);
  });

  it('reports every error at once and logs an INVALID line per variable', () => {
    const env = prodEnv({ PORT: '0', POLL_INTERVAL_MS: 'fast', CONTRACT_ID: undefined });
    const result = validateIndexerEnv(env);
    expect(result.errors.map((e) => e.variable).sort()).toEqual([
      'CONTRACT_ID',
      'POLL_INTERVAL_MS',
      'PORT',
    ]);
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(reportConfigValidation(env, result, logger)).toBe(false);
    const lines = logger.error.mock.calls.map((c) => c[0] as string);
    expect(lines.filter((l) => l.startsWith('[config] INVALID '))).toHaveLength(3);
    expect(lines.at(-1)).toMatch(/Refusing to start: 3 configuration error\(s\).*exit code 78/);
    expect(logger.log).not.toHaveBeenCalled();
  });
});

describe('startup config validation — boundaries', () => {
  const below = (name: string) => String(NUMERIC_RULES[name].min - 1);
  const atMin = (name: string) => String(NUMERIC_RULES[name].min);

  it.each(Object.keys(NUMERIC_RULES).filter((n) => NUMERIC_RULES[n].min > 0))(
    '%s: minimum is accepted, one below is rejected',
    (name) => {
      // Purge is cross-checked against the archive window; isolate its own bound.
      const ctx = name === 'ARCHIVE_PURGE_OLDER_THAN_DAYS' ? { ARCHIVE_OLDER_THAN_DAYS: '1' } : {};
      expect(errorVars(prodEnv({ ...ctx, [name]: atMin(name) }))).toEqual([]);
      expect(errorVars(prodEnv({ ...ctx, [name]: below(name) }))).toEqual([name]);
    }
  );

  it.each(Object.keys(NUMERIC_RULES).filter((n) => NUMERIC_RULES[n].max !== undefined))(
    '%s: maximum is accepted, one above is rejected',
    (name) => {
      const max = NUMERIC_RULES[name].max!;
      expect(errorVars(prodEnv({ [name]: String(max) }))).toEqual([]);
      expect(errorVars(prodEnv({ [name]: String(max + 1) }))).toEqual([name]);
    }
  );

  it('POLL_INTERVAL_MS below 100 ms is rejected — it would hammer the RPC node', () => {
    expect(errorVars(prodEnv({ POLL_INTERVAL_MS: '99' }))).toEqual(['POLL_INTERVAL_MS']);
    expect(errorVars(prodEnv({ POLL_INTERVAL_MS: '0' }))).toEqual(['POLL_INTERVAL_MS']);
  });

  it('accepts zero where zero means "unlimited" or "auto"', () => {
    expect(
      errorVars(
        prodEnv({
          START_LEDGER: '0',
          CONFIRMATION_DEPTH: '0',
          SUBSCRIPTION_MAX_CONNECTIONS_PER_IP: '0',
        })
      )
    ).toEqual([]);
  });

  it('purge must not happen before archive: equal is fine, smaller is rejected', () => {
    expect(
      errorVars(prodEnv({ ARCHIVE_OLDER_THAN_DAYS: '30', ARCHIVE_PURGE_OLDER_THAN_DAYS: '30' }))
    ).toEqual([]);
    expect(
      errorVars(prodEnv({ ARCHIVE_OLDER_THAN_DAYS: '30', ARCHIVE_PURGE_OLDER_THAN_DAYS: '29' }))
    ).toEqual(['ARCHIVE_PURGE_OLDER_THAN_DAYS']);
  });

  it('CONFIRMATION_DEPTH bounds match the confirmation policy (0..1000)', async () => {
    const { CanonicalConfirmationPolicy } = await import('../src/policy');
    expect(
      () => new CanonicalConfirmationPolicy(NUMERIC_RULES.CONFIRMATION_DEPTH.max)
    ).not.toThrow();
    expect(
      () => new CanonicalConfirmationPolicy(NUMERIC_RULES.CONFIRMATION_DEPTH.max! + 1)
    ).toThrow();
  });
});

describe('restart and replay', () => {
  it('validation is deterministic: the same environment gives the same verdict on every restart', () => {
    const env = prodEnv({ POLL_INTERVAL_MS: 'nope' });
    const first = validateIndexerEnv(env);
    expect(validateIndexerEnv(env)).toEqual(first);
    expect(validateIndexerEnv({ ...env })).toEqual(first);
  });

  it('START_LEDGER applies only to an empty database', () => {
    expect(resolveStartLedger(0, 123_456, null)).toBe(123_456);
  });

  it('a stored cursor wins over START_LEDGER on restart, so replay cannot rewind or skip', () => {
    expect(resolveStartLedger(500_000, 123_456, null)).toBe(500_000);
    expect(resolveStartLedger(500_000, 900_000, null)).toBe(500_000);
  });

  it('auto-detect starts AUTO_START_LOOKBACK ledgers before the tip, never below ledger 1', () => {
    expect(resolveStartLedger(0, 0, 50_000)).toBe(50_000 - AUTO_START_LOOKBACK);
    expect(resolveStartLedger(0, 0, AUTO_START_LOOKBACK + 1)).toBe(1);
    expect(resolveStartLedger(0, 0, AUTO_START_LOOKBACK)).toBe(1);
    expect(resolveStartLedger(0, 0, 5)).toBe(1);
  });

  it('auto-detect without a known tip fails instead of guessing', () => {
    expect(() => resolveStartLedger(0, 0, null)).toThrow(/Latest ledger is required/);
  });
});

describe('redaction helpers', () => {
  it('hides URL credentials', () => {
    expect(redactUrl('redis://user:pw@host:6379')).toBe('redis://***:***@host:6379');
    expect(redactUrl(undefined)).toBe('unset');
    expect(configSummary(prodEnv(), validateIndexerEnv(prodEnv()))).toContain('redis=unset');
  });
});

/**
 * The real entry point, as a separate process with no mocks: an invalid
 * environment must exit with code 78 before the HTTP port is opened or the
 * RPC node is contacted.
 */
describe('entry point (src/index.ts) — unavailable/invalid configuration', () => {
  const indexerDir = resolve(__dirname, '..');
  let port = 0;
  beforeEach(() => {
    port = 40_000 + Math.floor(Math.random() * 10_000);
  });

  it('exits 78 with INVALID lines and never listens', () => {
    const child = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: indexerDir,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        CONTRACT_ID: CONTRACT,
        RPC_URL: 'http://127.0.0.1:9', // unreachable: must never be contacted
        DB_PATH: join(tmp, 'entry.db'),
        PORT: String(port),
        POLL_INTERVAL_MS: '5s',
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(child.status).toBe(CONFIG_EXIT_CODE);
    expect(child.stderr).toContain('[config] INVALID POLL_INTERVAL_MS');
    expect(child.stderr).toContain('Refusing to start');
    expect(child.stdout).not.toContain('[api] Listening');
    expect(child.stdout).not.toContain('[poller] Starting');
  }, 90_000);
});
