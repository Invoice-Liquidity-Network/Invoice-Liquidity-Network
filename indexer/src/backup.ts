import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  readFileSync,
  copyFileSync,
} from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import Database from 'better-sqlite3';
import { CONFIG } from './config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackupConfig {
  /** Directory to store local backup files. */
  backupDir: string;
  /** How often to run backups in milliseconds (default: 24 hours). */
  intervalMs: number;
  /** Maximum number of local backups to retain (oldest are deleted). */
  maxLocalBackups: number;
  /** Optional cloud storage configuration. */
  cloud?: CloudStorageConfig;
}

export interface CloudStorageConfig {
  /** Cloud provider: "s3", "gcs", or "azure". */
  provider: 's3' | 'gcs' | 'azure';
  /** Bucket or container name. */
  bucket: string;
  /** Optional prefix/folder within the bucket. */
  prefix?: string;
  /** Region for the cloud storage. */
  region?: string;
}

export interface BackupManifest {
  /** ISO 8601 timestamp of the backup. */
  timestamp: string;
  /** Backup file name. */
  filename: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** SHA-256 checksum of the backup file. */
  checksum: string;
  /** Ledger sequence at time of backup. */
  ledgerSequence: number;
  /** Whether the backup passed verification. */
  verified: boolean;
}

export interface RestoreOptions {
  /** Path to the backup file to restore from. */
  backupPath: string;
  /** Whether to verify the backup before restoring. */
  verify?: boolean;
  /** The target database path to restore to. */
  targetDbPath?: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_BACKUP_DIR = './backups';
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MAX_LOCAL_BACKUP = 30;

// ─── Backup Manager ───────────────────────────────────────────────────────────

export class BackupManager {
  private config: BackupConfig;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(config?: Partial<BackupConfig>) {
    this.config = {
      backupDir: config?.backupDir ?? DEFAULT_BACKUP_DIR,
      intervalMs: config?.intervalMs ?? DEFAULT_INTERVAL_MS,
      maxLocalBackups: config?.maxLocalBackups ?? DEFAULT_MAX_LOCAL_BACKUP,
      cloud: config?.cloud,
    };

    if (!existsSync(this.config.backupDir)) {
      mkdirSync(this.config.backupDir, { recursive: true });
    }
  }

  /**
   * Start the automated backup scheduler.
   * Runs an immediate backup, then schedules periodic backups.
   */
  start(): void {
    if (this.timer) return;

    console.log(`[backup] Starting backup scheduler — interval: ${this.config.intervalMs}ms`);

    // Run initial backup
    this.runBackup().catch((err) => {
      console.error('[backup] Initial backup failed:', err);
    });

    this.timer = setInterval(() => {
      this.runBackup().catch((err) => {
        console.error('[backup] Scheduled backup failed:', err);
      });
    }, this.config.intervalMs);
  }

  /**
   * Stop the backup scheduler.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    console.log('[backup] Backup scheduler stopped');
  }

  /**
   * Run a single backup cycle: dump, verify, optionally upload, and prune.
   * @returns The backup manifest if successful, null on failure.
   */
  async runBackup(): Promise<BackupManifest | null> {
    if (this.running) {
      console.log('[backup] Backup already in progress, skipping');
      return null;
    }

    this.running = true;
    const startTime = Date.now();

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `iln-backup-${timestamp}.db`;
      const backupPath = join(this.config.backupDir, filename);

      console.log(`[backup] Starting backup to ${backupPath}`);

      // Dump the SQLite database
      this.dumpDatabase(backupPath);

      // Verify the backup
      const verified = this.verifyBackup(backupPath);

      // Get file size and checksum
      const stats = statSync(backupPath);
      const checksum = this.computeChecksum(backupPath);

      // Get current ledger sequence
      const ledgerSequence = this.getCurrentLedgerSequence();

      const manifest: BackupManifest = {
        timestamp: new Date().toISOString(),
        filename,
        sizeBytes: stats.size,
        checksum,
        ledgerSequence,
        verified,
      };

      // Save manifest alongside backup
      const manifestPath = join(this.config.backupDir, `${filename}.manifest.json`);
      const { writeFileSync } = await import('fs');
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      // Upload to cloud if configured
      if (this.config.cloud) {
        await this.uploadToCloud(backupPath, filename);
      }

      // Prune old backups
      this.pruneOldBackups();

      const elapsed = Date.now() - startTime;
      console.log(
        `[backup] Backup complete: ${filename} (${stats.size} bytes, verified: ${verified}, ${elapsed}ms)`
      );

      return manifest;
    } catch (error) {
      console.error('[backup] Backup failed:', error);
      return null;
    } finally {
      this.running = false;
    }
  }

  /**
   * Dump the SQLite database to a file using sqlite3 CLI.
   */
  private dumpDatabase(backupPath: string): void {
    const dbPath = CONFIG.dbPath;
    try {
      execSync(`sqlite3 "${dbPath}" ".backup '${backupPath}'"`, {
        stdio: 'pipe',
        timeout: 60_000,
      });
    } catch {
      // Fallback: try using VACUUM INTO (SQLite 3.27+)
      try {
        execSync(`sqlite3 "${dbPath}" "VACUUM INTO '${backupPath}';"`, {
          stdio: 'pipe',
          timeout: 60_000,
        });
      } catch (fallbackErr) {
        throw new Error(
          `Failed to dump database: ${
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
          }`
        );
      }
    }
  }

  /**
   * Verify a backup file by running a integrity check.
   */
  verifyBackup(backupPath: string): boolean {
    try {
      const result = execSync(`sqlite3 "${backupPath}" "PRAGMA integrity_check;"`, {
        stdio: 'pipe',
        timeout: 30_000,
      });
      const output = result.toString().trim();
      return output === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Compute SHA-256 checksum of a file.
   */
  private computeChecksum(filePath: string): string {
    try {
      const result = execSync(`sha256sum "${filePath}"`, { stdio: 'pipe' });
      return result.toString().split(' ')[0];
    } catch {
      return '';
    }
  }

  /**
   * Get the current ledger sequence from the database cursor.
   */
  private getCurrentLedgerSequence(): number {
    try {
      const db = new Database(CONFIG.dbPath, { readonly: true });
      const row = db.prepare('SELECT last_ledger FROM cursor WHERE id = 1').get() as
        | { last_ledger: number }
        | undefined;
      db.close();
      return row?.last_ledger ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Upload backup to configured cloud storage.
   */
  private async uploadToCloud(localPath: string, filename: string): Promise<void> {
    const cloud = this.config.cloud!;
    const objectKey = cloud.prefix ? `${cloud.prefix}/${filename}` : filename;

    console.log(`[backup] Uploading to ${cloud.provider}:${cloud.bucket}/${objectKey}`);

    switch (cloud.provider) {
      case 's3':
        await this.uploadToS3(localPath, objectKey, cloud);
        break;
      case 'gcs':
        await this.uploadToGcs(localPath, objectKey, cloud);
        break;
      case 'azure':
        await this.uploadToAzure(localPath, objectKey, cloud);
        break;
    }
  }

  private async uploadToS3(
    localPath: string,
    key: string,
    cloud: CloudStorageConfig
  ): Promise<void> {
    const region = cloud.region ?? 'us-east-1';
    execSync(`aws s3 cp "${localPath}" "s3://${cloud.bucket}/${key}" --region ${region}`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
  }

  private async uploadToGcs(
    localPath: string,
    key: string,
    cloud: CloudStorageConfig
  ): Promise<void> {
    execSync(`gsutil cp "${localPath}" "gs://${cloud.bucket}/${key}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
  }

  private async uploadToAzure(
    localPath: string,
    key: string,
    cloud: CloudStorageConfig
  ): Promise<void> {
    execSync(
      `az storage blob upload --file "${localPath}" --name "${key}" --container-name "${cloud.bucket}"`,
      { stdio: 'pipe', timeout: 120_000 }
    );
  }

  /**
   * Prune old local backups beyond the retention limit.
   */
  pruneOldBackups(): void {
    const files = readdirSync(this.config.backupDir)
      .filter((f) => f.startsWith('iln-backup-') && f.endsWith('.db'))
      .map((f) => ({
        name: f,
        path: join(this.config.backupDir, f),
        time: statSync(join(this.config.backupDir, f)).mtimeMs,
      }))
      .sort((a, b) => a.time - b.time);

    const excess = files.length - this.config.maxLocalBackups;
    if (excess <= 0) return;

    for (let i = 0; i < excess; i++) {
      const file = files[i];
      try {
        unlinkSync(file.path);
        // Also remove manifest
        const manifestPath = `${file.path}.manifest.json`;
        if (existsSync(manifestPath)) {
          unlinkSync(manifestPath);
        }
        console.log(`[backup] Pruned old backup: ${file.name}`);
      } catch (err) {
        console.error(`[backup] Failed to prune ${file.name}:`, err);
      }
    }
  }

  /**
   * Restore a database from a backup file.
   */
  async restore(options: RestoreOptions): Promise<void> {
    const backupPath = options.backupPath;
    const targetPath = options.targetDbPath ?? CONFIG.dbPath;

    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    // Verify before restoring if requested
    if (options.verify !== false) {
      const verified = this.verifyBackup(backupPath);
      if (!verified) {
        throw new Error(`Backup verification failed: ${backupPath}`);
      }
      console.log('[backup] Backup verification passed');
    }

    console.log(`[backup] Restoring from ${backupPath} to ${targetPath}`);

    // Copy the backup file to the target location without invoking a shell
    copyFileSync(backupPath, targetPath);

    console.log('[backup] Restore complete');
  }

  /**
   * List all available local backups.
   */
  listBackups(): BackupManifest[] {
    const manifests: BackupManifest[] = [];
    const files = readdirSync(this.config.backupDir).filter((f) => f.endsWith('.manifest.json'));

    for (const file of files) {
      try {
        const content = readFileSync(join(this.config.backupDir, file), 'utf-8');
        manifests.push(JSON.parse(content));
      } catch {
        // Skip malformed manifests
      }
    }

    return manifests.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Get the latest backup manifest.
   */
  getLatestBackup(): BackupManifest | null {
    const backups = this.listBackups();
    return backups.length > 0 ? backups[backups.length - 1] : null;
  }
}

// ─── CLI entry ────────────────────────────────────────────────────────────────
// Enables `node dist/backup.js`, which the nightly GitHub Actions workflow
// (.github/workflows/indexer-backup.yml) runs to produce a backup artifact.
// Runs a single on-demand backup cycle using the environment configuration
// (BACKUP_DIR, BACKUP_INTERVAL_MS, BACKUP_MAX_LOCAL, BACKUP_CLOUD_*).
if (require.main === module) {
  (async () => {
    const manager = new BackupManager({
      backupDir: CONFIG.backupDir,
      intervalMs: CONFIG.backupIntervalMs,
      maxLocalBackups: CONFIG.backupMaxLocal,
      cloud: CONFIG.backupCloudProvider
        ? {
            provider: CONFIG.backupCloudProvider,
            bucket: CONFIG.backupCloudBucket ?? '',
            prefix: CONFIG.backupCloudPrefix,
            region: CONFIG.backupCloudRegion,
          }
        : undefined,
    });

    const manifest = await manager.runBackup();
    if (!manifest) {
      console.error('[backup] Backup failed');
      process.exit(1);
    }

    console.log(JSON.stringify(manifest, null, 2));
  })().catch((err: unknown) => {
    console.error('[backup] Backup failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
