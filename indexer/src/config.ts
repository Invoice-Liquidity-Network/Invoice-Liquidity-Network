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
} as const;
