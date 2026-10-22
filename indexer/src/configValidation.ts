import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isIP } from 'node:net';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Fail-closed startup validation for the indexer's environment.
 *
 * `config.ts` turns environment variables into values with `Number(...)` and
 * `??` defaults, which never fails: `POLL_INTERVAL_MS=5s` becomes `NaN` (a
 * ~1 ms polling loop against the RPC node), `PORT=` becomes `0` (a random
 * port), `BACKUP_ENABLED=TRUE` silently disables backups. This module checks
 * the raw strings *before* anything starts, reports every problem at once, and
 * `index.ts` exits with {@link CONFIG_EXIT_CODE} if any error is found.
 *
 * The rules here are the documented contract in
 * docs/indexer/configuration.md ("Startup validation"); the docs check
 * `scripts/check-indexer-ops-docs.mjs` fails CI if a variable read by the
 * indexer is missing from that page.
 */

/** sysexits.h EX_CONFIG — "configuration error". Distinguishes bad config from a crash. */
export const CONFIG_EXIT_CODE = 78;

export interface ConfigIssue {
  variable: string;
  problem: string;
}

export interface ConfigValidationResult {
  ok: boolean;
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
  network: StellarNetwork;
}

export type StellarNetwork = 'mainnet' | 'testnet' | 'futurenet' | 'standalone' | 'custom';

const PASSPHRASES: Record<string, StellarNetwork> = {
  'Public Global Stellar Network ; September 2015': 'mainnet',
  'Test SDF Network ; September 2015': 'testnet',
  'Test SDF Future Network ; October 2022': 'futurenet',
  'Standalone Network ; February 2017': 'standalone',
};

const DEFAULT_PASSPHRASE = 'Test SDF Network ; September 2015';

export function networkForPassphrase(passphrase: string): StellarNetwork {
  return PASSPHRASES[passphrase] ?? 'custom';
}

/** Integer bounds for numeric variables; `max` is inclusive. */
export const NUMERIC_RULES: Record<string, { min: number; max?: number; unit?: string }> = {
  PORT: { min: 1, max: 65_535 },
  POLL_INTERVAL_MS: { min: 100, max: 3_600_000, unit: 'ms' },
  START_LEDGER: { min: 0 },
  CONFIRMATION_DEPTH: { min: 0, max: 1_000, unit: 'ledgers' },
  RATE_LIMIT_WINDOW_MS: { min: 1_000, unit: 'ms' },
  RATE_LIMIT_MAX: { min: 1 },
  SUBSCRIPTION_MAX_CONNECTIONS: { min: 0 },
  SUBSCRIPTION_MAX_CONNECTIONS_PER_IP: { min: 0 },
  ARCHIVE_INTERVAL_MS: { min: 60_000, unit: 'ms' },
  ARCHIVE_OLDER_THAN_DAYS: { min: 1, unit: 'days' },
  ARCHIVE_PURGE_OLDER_THAN_DAYS: { min: 1, unit: 'days' },
  BACKUP_INTERVAL_MS: { min: 60_000, unit: 'ms' },
  BACKUP_MAX_LOCAL: { min: 1 },
  ANALYTICS_QUERY_BUDGET_MS: { min: 1, unit: 'ms' },
  EXPORT_SESSION_MAX_ROWS: { min: 1 },
  EXPORT_SESSION_MAX_SECONDS: { min: 1 },
  EXPORT_SESSION_MAX_BYTES: { min: 1 },
  EXPORT_PAGE_MAX_ROWS: { min: 1 },
  EXPORT_JOB_TTL_SECONDS: { min: 1 },
  EXPORT_JOB_MAX: { min: 1 },
};

/** Variables the code compares against an exact literal; anything else silently flips behaviour. */
const BOOLEAN_VARS = ['ARCHIVE_ENABLED', 'BACKUP_ENABLED'] as const;

const BACKUP_PROVIDERS = ['s3', 'gcs', 'azure'];

/** Strict non-negative integer: rejects "", "5s", "5e3", "1.5", "-1", "0x10". */
const INTEGER = /^\d+$/;

export interface ValidateOptions {
  /** Check that DB_PATH's directory exists and is writable (default true). */
  checkFilesystem?: boolean;
}

export function validateIndexerEnv(
  env: NodeJS.ProcessEnv,
  options: ValidateOptions = {}
): ConfigValidationResult {
  const errors: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];
  const error = (variable: string, problem: string) => errors.push({ variable, problem });
  const warn = (variable: string, problem: string) => warnings.push({ variable, problem });
  const production = env.NODE_ENV === 'production';
  const checkFilesystem = options.checkFilesystem ?? true;

  // ── Numbers ────────────────────────────────────────────────────────────────
  const numbers: Record<string, number> = {};
  for (const [name, rule] of Object.entries(NUMERIC_RULES)) {
    const raw = env[name];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value === '') {
      // config.ts uses `??`, so an empty value is NOT replaced by the default.
      error(name, 'is set but empty; remove it to use the default');
      continue;
    }
    if (!INTEGER.test(value)) {
      error(name, `must be a whole number${rule.unit ? ` of ${rule.unit}` : ''}, got "${raw}"`);
      continue;
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < rule.min || (rule.max !== undefined && n > rule.max)) {
      const range =
        rule.max === undefined ? `>= ${rule.min}` : `between ${rule.min} and ${rule.max}`;
      error(name, `must be ${range}${rule.unit ? ` ${rule.unit}` : ''}, got ${value}`);
      continue;
    }
    numbers[name] = n;
  }

  const archiveDays = numbers.ARCHIVE_OLDER_THAN_DAYS ?? 90;
  const purgeDays = numbers.ARCHIVE_PURGE_OLDER_THAN_DAYS ?? 2555;
  if (
    (env.ARCHIVE_OLDER_THAN_DAYS !== undefined ||
      env.ARCHIVE_PURGE_OLDER_THAN_DAYS !== undefined) &&
    purgeDays < archiveDays &&
    !errors.some((e) => e.variable.startsWith('ARCHIVE_'))
  ) {
    error(
      'ARCHIVE_PURGE_OLDER_THAN_DAYS',
      `(${purgeDays}) must be >= ARCHIVE_OLDER_THAN_DAYS (${archiveDays}); data would be purged before it is archived`
    );
  }

  // ── Booleans ───────────────────────────────────────────────────────────────
  for (const name of BOOLEAN_VARS) {
    const raw = env[name];
    if (raw !== undefined && raw !== 'true' && raw !== 'false') {
      error(name, `must be exactly "true" or "false", got "${raw}"`);
    }
  }

  // ── Contract and network ──────────────────────────────────────────────────
  const contractId = env.CONTRACT_ID;
  if (contractId === undefined || contractId.trim() === '') {
    if (production) {
      error('CONTRACT_ID', 'is required when NODE_ENV=production');
    } else {
      warn('CONTRACT_ID', 'is not set; indexing the built-in testnet contract');
    }
  } else if (!StrKey.isValidContract(contractId.trim())) {
    error(
      'CONTRACT_ID',
      `must be a Stellar contract address (C…, 56 characters), got "${contractId}"`
    );
  }

  const passphrase = env.NETWORK_PASSPHRASE ?? DEFAULT_PASSPHRASE;
  if (passphrase.trim() === '') {
    error('NETWORK_PASSPHRASE', 'is set but empty');
  }
  const network = networkForPassphrase(passphrase);
  if (network === 'custom' && passphrase.trim() !== '') {
    warn('NETWORK_PASSPHRASE', 'is not a known Stellar network passphrase');
  }

  const rpcRaw = env.RPC_URL ?? 'https://soroban-testnet.stellar.org';
  let rpcUrl: URL | null = null;
  try {
    rpcUrl = new URL(rpcRaw);
    if (rpcUrl.protocol !== 'http:' && rpcUrl.protocol !== 'https:') {
      error('RPC_URL', `must be an http(s) URL, got protocol "${rpcUrl.protocol}"`);
      rpcUrl = null;
    }
  } catch {
    error('RPC_URL', 'must be an absolute http(s) URL');
  }
  if (rpcUrl) {
    const host = rpcUrl.hostname.toLowerCase();
    if (network === 'mainnet' && /testnet|futurenet/.test(host)) {
      error(
        'RPC_URL',
        `points at a ${
          host.includes('futurenet') ? 'futurenet' : 'testnet'
        } host while NETWORK_PASSPHRASE is mainnet`
      );
    } else if ((network === 'testnet' || network === 'futurenet') && /mainnet/.test(host)) {
      error('RPC_URL', `points at a mainnet host while NETWORK_PASSPHRASE is ${network}`);
    }
    if (production && rpcUrl.protocol === 'http:' && !isPrivateHost(host)) {
      warn('RPC_URL', 'uses plain http to a public host in production');
    }
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  const dbPath = env.DB_PATH ?? 'indexer.db';
  if (dbPath.trim() === '') {
    error('DB_PATH', 'is set but empty');
  } else if (dbPath === ':memory:') {
    if (production)
      error(
        'DB_PATH',
        '":memory:" loses all indexed data on restart and is not allowed in production'
      );
  } else if (checkFilesystem) {
    const problem = directoryProblem(dbPath);
    if (problem) error('DB_PATH', problem);
  }

  for (const name of ['ARCHIVE_DB_PATH', 'ANALYTICS_DB_PATH', 'BACKUP_DIR'] as const) {
    if (env[name] !== undefined && env[name]!.trim() === '') error(name, 'is set but empty');
  }

  // ── Backups ───────────────────────────────────────────────────────────────
  const provider = env.BACKUP_CLOUD_PROVIDER;
  if (provider !== undefined && provider !== '') {
    if (!BACKUP_PROVIDERS.includes(provider)) {
      error(
        'BACKUP_CLOUD_PROVIDER',
        `must be one of ${BACKUP_PROVIDERS.join(', ')}, got "${provider}"`
      );
    } else if (!env.BACKUP_CLOUD_BUCKET?.trim()) {
      error('BACKUP_CLOUD_BUCKET', `is required when BACKUP_CLOUD_PROVIDER=${provider}`);
    }
  } else if (env.BACKUP_CLOUD_BUCKET?.trim()) {
    warn('BACKUP_CLOUD_BUCKET', 'is ignored because BACKUP_CLOUD_PROVIDER is not set');
  }
  if (production && env.BACKUP_ENABLED !== 'true') {
    warn('BACKUP_ENABLED', 'automated backups are off in production');
  }

  // ── Rate limiting and subscriptions ───────────────────────────────────────
  const whitelist = (env.RATE_LIMIT_WHITELIST ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of whitelist) {
    if (isIP(entry) === 0) {
      error('RATE_LIMIT_WHITELIST', `entries must be IP addresses, got "${entry}"`);
    }
  }

  const token = env.SUBSCRIPTION_AUTH_TOKEN;
  if (token !== undefined && token !== '' && token.length < 16) {
    warn('SUBSCRIPTION_AUTH_TOKEN', 'is shorter than 16 characters');
  }

  if (env.REDIS_URL !== undefined && env.REDIS_URL !== '') {
    try {
      const redis = new URL(env.REDIS_URL);
      if (redis.protocol !== 'redis:' && redis.protocol !== 'rediss:') {
        error('REDIS_URL', `must use redis:// or rediss://, got "${redis.protocol}"`);
      }
    } catch {
      error('REDIS_URL', 'must be a redis:// or rediss:// URL');
    }
  }

  return { ok: errors.length === 0, errors, warnings, network };
}

function isPrivateHost(host: string): boolean {
  return (
    host === 'localhost' ||
    !host.includes('.') ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  );
}

/** Why SQLite could not create its file next to `path`, or null if it can. */
function directoryProblem(path: string): string | null {
  const dir = dirname(resolve(path));
  try {
    if (!statSync(dir).isDirectory()) return `parent "${dir}" is not a directory`;
  } catch {
    return `directory "${dir}" does not exist`;
  }
  try {
    accessSync(dir, fsConstants.W_OK);
  } catch {
    return `directory "${dir}" is not writable`;
  }
  return null;
}

/** Hide credentials embedded in a URL (e.g. redis://:password@host). */
export function redactUrl(raw: string | undefined): string {
  if (!raw) return 'unset';
  try {
    const url = new URL(raw);
    if (url.password) url.password = '***';
    if (url.username) url.username = '***';
    return url.toString();
  } catch {
    return 'set (unparseable)';
  }
}

/** One-line, secret-free summary for the startup log. */
export function configSummary(env: NodeJS.ProcessEnv, result: ConfigValidationResult): string {
  const parts = [
    `network=${result.network}`,
    `contract=${env.CONTRACT_ID?.trim() || 'default-testnet'}`,
    `rpc=${redactUrl(env.RPC_URL ?? 'https://soroban-testnet.stellar.org')}`,
    `db=${env.DB_PATH ?? 'indexer.db'}`,
    `port=${env.PORT ?? '3001'}`,
    `poll=${env.POLL_INTERVAL_MS ?? '5000'}ms`,
    `confirmationDepth=${env.CONFIRMATION_DEPTH ?? '10'}`,
    `redis=${redactUrl(env.REDIS_URL)}`,
    `subscriptionAuth=${env.SUBSCRIPTION_AUTH_TOKEN ? 'set' : 'unset'}`,
    `archive=${env.ARCHIVE_ENABLED === 'false' ? 'off' : 'on'}`,
    `backup=${env.BACKUP_ENABLED === 'true' ? 'on' : 'off'}`,
    `warnings=${result.warnings.length}`,
  ];
  return parts.join(' ');
}

interface Logger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Log the validation outcome. Returns true when startup may continue.
 * Log prefixes (`[config] OK`, `[config] WARN`, `[config] INVALID`) are what
 * docs/indexer/operations-checks.md tells operators to search for.
 */
export function reportConfigValidation(
  env: NodeJS.ProcessEnv,
  result: ConfigValidationResult,
  logger: Logger = console
): boolean {
  for (const w of result.warnings) logger.warn(`[config] WARN ${w.variable} ${w.problem}`);
  if (!result.ok) {
    for (const e of result.errors) logger.error(`[config] INVALID ${e.variable} ${e.problem}`);
    logger.error(
      `[config] Refusing to start: ${result.errors.length} configuration error(s). ` +
        `Fix them and restart (exit code ${CONFIG_EXIT_CODE}). See docs/indexer/operations-checks.md`
    );
    return false;
  }
  logger.log(`[config] OK ${configSummary(env, result)}`);
  return true;
}
