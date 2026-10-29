# Indexer Backup/Restore Drill — 2026-10-01

Planned actions
- Acquire or generate a production-sized snapshot (TBD).
- Execute backup → restore → integrity verification per `docs/indexer/backup-archive.md`.
- Record wall-clock RTO and data-loss window (RPO).

Status
- Snapshot acquisition: pending — requires coordination with infra to obtain a production-sized dataset or generate an equivalent via synthetic replay.
- Automated steps (backup manager, restore endpoints) exist in `indexer/src/backup.ts` and `indexer/src/api.ts`.

Next steps
- Arrange snapshot access from infra and run the documented procedure in staging.
- Capture timings and update this document with RTO/RPO numbers and required procedural changes.
