import { config as loadEnv } from 'dotenv';

loadEnv();

export const CONFIG = {
  contractId: process.env.CONTRACT_ID ?? 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC',
  networkPassphrase: process.env.NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  rpcUrl: process.env.RPC_URL ?? 'https://soroban-testnet.stellar.org',
  dbPath: process.env.DB_PATH ?? 'indexer.db',
  /** Polling interval in milliseconds (default: 5 seconds). */
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? '5000'),
  /** HTTP port for the REST API. */
  apiPort: Number(process.env.PORT ?? '3001'),
  /**
   * Ledger to start indexing from on first run.
   * 0 = automatically start from (latestLedger - 1000).
   */
  startLedger: Number(process.env.START_LEDGER ?? '0'),
  /** Optional Redis connection URL (e.g. redis://localhost:6379). Caching is disabled when unset. */
  redisUrl: process.env.REDIS_URL,
  /** Rate limit window for the public API, in ms (default: 60 seconds). */
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? '60000'),
  /** Max requests per IP per window (default: 100). */
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? '100'),
  /**
   * Comma-separated list of IPs exempt from rate limiting, e.g. for
   * internal services and monitoring (e.g. "10.0.0.5,10.0.0.6").
   */
  rateLimitWhitelist: (process.env.RATE_LIMIT_WHITELIST ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean),
  /** Archival schedule interval in ms (default: 24 hours). */
  archiveIntervalMs: Number(process.env.ARCHIVE_INTERVAL_MS ?? '86400000'),
  /** Retention period in days (default: 90 days). */
  archiveOlderThanDays: Number(process.env.ARCHIVE_OLDER_THAN_DAYS ?? '90'),
  /** Whether automatic background archival is enabled. */
  archiveEnabled: process.env.ARCHIVE_ENABLED !== 'false',
  /** Enable automated backups (default: false). */
  backupEnabled: process.env.BACKUP_ENABLED === 'true',
  /** Backup interval in milliseconds (default: 24 hours). */
  backupIntervalMs: Number(process.env.BACKUP_INTERVAL_MS ?? String(24 * 60 * 60 * 1000)),
  /** Directory to store backup files (default: ./backups). */
  backupDir: process.env.BACKUP_DIR ?? './backups',
  /** Maximum number of local backups to retain (default: 30). */
  backupMaxLocal: Number(process.env.BACKUP_MAX_LOCAL ?? '30'),
  /** Cloud storage provider for backups: "s3", "gcs", or "azure". */
  backupCloudProvider: process.env.BACKUP_CLOUD_PROVIDER as 's3' | 'gcs' | 'azure' | undefined,
  /** Cloud storage bucket name for backups. */
  backupCloudBucket: process.env.BACKUP_CLOUD_BUCKET,
  /** Optional prefix/folder within the cloud bucket. */
  backupCloudPrefix: process.env.BACKUP_CLOUD_PREFIX,
  /** Cloud storage region. */
  backupCloudRegion: process.env.BACKUP_CLOUD_REGION,
} as const;
