# Indexer Backup & Archive

## Overview

The indexer has two data-preservation mechanisms:

| Mechanism | Purpose | Default |
|-----------|---------|---------|
| **Archive** | Move old invoices to a separate archive database | ✅ Enabled |
| **Backup** | Create periodic snapshots of the full database | ❌ Disabled by default |

Both run **inside the indexer process** at configurable intervals. They are
not external cron jobs.

## Archive

The archive moves invoices older than a threshold out of the primary database
into a separate archive file. This keeps the primary database lean. Furthermore, the 
indexer enforces a strict data-minimization and legal-hold lifecycle policy by permanently 
purging data from the archive after a specified duration (e.g., 7 years).

```env
ARCHIVE_ENABLED=true           # enabled by default
ARCHIVE_INTERVAL_MS=86400000   # check once per day
ARCHIVE_OLDER_THAN_DAYS=90     # archive invoices older than 90 days
ARCHIVE_PURGE_OLDER_THAN_DAYS=2555 # permanently purge invoices older than 7 years (2555 days)
ARCHIVE_DB_PATH=archive.db     # archive file path
```

## Backup

The backup creates compressed snapshots of the database file at a regular
cadence. It retains a configurable number of recent backups and can optionally
push to cloud storage (S3, GCS, or Azure).

```env
BACKUP_ENABLED=false           # disabled by default — enable in production
BACKUP_DIR=./backups           # local backup directory
BACKUP_INTERVAL_MS=86400000    # one snapshot per day
BACKUP_MAX_LOCAL=7             # keep 7 most recent backups locally
```

### Enabling backups

```bash
# In production, set:
BACKUP_ENABLED=true
BACKUP_DIR=/var/data/backups
BACKUP_INTERVAL_MS=86400000
BACKUP_MAX_LOCAL=30

# Optional cloud storage (S3 example):
BACKUP_CLOUD_PROVIDER=s3
BACKUP_CLOUD_BUCKET=my-org-iln-backups
BACKUP_CLOUD_REGION=us-east-1
```

## GitHub Actions Nightly Backup

In addition to the in-process backup, a **nightly workflow** runs at 02:00 UTC
as a safety net:

- `.github/workflows/indexer-backup.yml`
- Runs even if the in-process backup is disabled
- Produces a downloadable artifact (retained for 7 days)
- Fails loudly (GitHub notifications) on error

## Failure Alerting

When the in-process backup fails:
1. The error is logged to the indexer's log stream
2. The backup is retried on the next interval

When the GitHub Actions backup fails:
1. The workflow run is marked as failed
2. A warning is logged to the Actions run
3. Repository notifications alert the configured watchers

## Manual Recovery

To restore from a backup:

```bash
# 1. Stop the indexer
# 2. Replace the database
cp /path/to/backup/indexer.db /path/to/indexer/data/indexer.db
# 3. Restart the indexer
```

## Restore Verification

> **Verified 2026-08-26.** A full backup → clean-environment restore → data
> check cycle was executed with the real mechanisms and timed. This is the
> evidence behind the `Backups verified` item on the
> [mainnet launch checklist](../mainnet-launch-checklist.md).

### 1. Backup (real mechanism)

A backup was produced with the exact command the nightly
[`indexer-backup.yml`](../../.github/workflows/indexer-backup.yml) workflow
runs (`node dist/backup.js`), pointed at a database synced to testnet
ledger **4,712,427** (40 invoices, 82 events):

| Measurement | Value |
| --- | --- |
| Wall-clock backup time (incl. Node startup) | **93 ms** |
| Internal dump + verify time | **44 ms** |
| Artifact | `iln-backup-2026-08-26T19-05-02-859Z.db` |
| Size | 81,920 bytes |
| SHA-256 | `d5f1fec28227d11b50a85a2aa47a98658e74b88cddd2943b3079a2ca8da5d7ea` |
| `PRAGMA integrity_check` | `ok` (`verified: true` in manifest) |
| Ledger sequence in manifest | 4,712,427 |

### 2. Restore into a clean environment

The backup was restored into a **freshly created, empty directory** (no
residual state — no existing database, WAL, or shm files) using
`BackupManager.restore()` with integrity verification enabled:

| Measurement | Value |
| --- | --- |
| Pre-restore verification | passed (`integrity_check` = `ok`) |
| Wall-clock restore time (verify + copy) | **9.9 ms** |
| Restored file size | 81,920 bytes (identical to backup) |

### 3. Restored indexer serves correct data

A fresh indexer process was started against the restored database and its
REST API probed. Every response matched the pre-backup state:

| Endpoint | Result | Matches pre-backup? |
| --- | --- | --- |
| `GET /health` | `{"status":"ok","db":"ok","lastSync":"…"}` | ✅ db ok, cursor intact |
| `GET /invoices` | 40 invoices served | ✅ same count |
| `GET /invoice/7` | row `id=7`, `amount=80000000`, `discount_rate=400`, `Pending` | ✅ identical |
| `GET /invoice/23` | row `id=23`, `Paid`, funder `GLPS…` | ✅ identical |
| `GET /stats` | `totalInvoices=40`, `totalVolume=1940000000` | ✅ identical |
| `GET /export/invoices?status=Paid` | 12 rows | ✅ same as pre-backup count |
| `GET /backup/latest` | same manifest + checksum as created | ✅ artifact readable |

### 4. Recovery time

| Phase | Measured time |
| --- | --- |
| Backup (dump + verify + manifest) | 44 ms (93 ms wall with Node startup) |
| Restore (verify + copy into clean DB) | 9.9 ms |
| Process restart + API ready | ~2 s (cold boot of the Node process) |
| **End-to-end recovery** | **< 3 s** for a ~80 KB database |

Recovery is dominated by process startup, not data movement: SQLite backups are
hot copies (`.backup` online backup API) and restores are a verified file copy,
so the times scale with database size and remain in the millisecond range for
indexer-sized databases.

### 5. Re-running this verification

```bash
# From the indexer package (after `pnpm run build`):
# 1. Backup — the exact nightly-workflow command
DB_PATH=/path/to/indexer.db BACKUP_DIR=/tmp/iln-backups BACKUP_MAX_LOCAL=7 \
  node dist/backup.js

# 2. Restore into a clean directory
mkdir -p /tmp/iln-restored
cp /tmp/iln-backups/iln-backup-*.db /tmp/iln-restored/indexer.db
sqlite3 /tmp/iln-restored/indexer.db 'PRAGMA integrity_check;'   # expect: ok

# 3. Serve the restored database and probe the API
DB_PATH=/tmp/iln-restored/indexer.db PORT=3001 node dist/index.js
curl -s localhost:3001/health
curl -s localhost:3001/stats
```
