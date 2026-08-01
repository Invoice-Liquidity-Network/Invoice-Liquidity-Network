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
into a separate archive file. This keeps the primary database lean.

```env
ARCHIVE_ENABLED=true           # enabled by default
ARCHIVE_INTERVAL_MS=86400000   # check once per day
ARCHIVE_OLDER_THAN_DAYS=90     # archive invoices older than 90 days
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
