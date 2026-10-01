# Indexer Backup/Restore Drill — How to run

Prerequisites
- A staging environment running the indexer with backup endpoints enabled and reachable from the machine running this script. Set `INDEXER_URL` if not `http://localhost:3000`.

Quick run

```bash
export INDEXER_URL=https://staging-indexer.example.org
node scripts/drills/indexer-backup-restore.mjs
```

The script will:
- Trigger an indexer backup via `POST /backup`.
- Fetch `GET /backup/latest` to discover the backup path.
- Trigger `POST /backup/restore` to restore the backup.
- Trigger `POST /backup/verify` to run integrity verification if supported.
- Record step timings in `drills/indexer-backup-restore-2026-10-01.jsonl`.

After the run
- Inspect the generated JSONL file for RTO and verification results.
- If the restore fails or verification reports mismatches, follow `docs/indexer/backup-archive.md` and capture logs.
