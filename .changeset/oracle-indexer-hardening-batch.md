---
"@iln/oracle-service": minor
"iln-indexer": minor
---

Stellar Wave hardening batch (oracle-service #1052/#1051, indexer #1042/#1041):

- oracle-service now enforces manipulation-resistant maximum single-update deltas per feed; over-bound updates require multi-source quorum, are held for human review (never silently dropped), and surface via metrics, a `/v1/oracle/delta-holds` review endpoint, and Prometheus alert rules.
- oracle-service source failover is automated: primary/secondary indexer and reputation endpoints with error-rate/latency/staleness health tracking, anti-flapping failback, and a documented runbook with an automated outage drill.
- indexer bulk export/streaming pagination now runs on true row streaming with per-session resource budgets (rows, bytes, wall-clock) and a cursor-based resumption mechanism; export job state is TTL-bounded. Load-tested via `pnpm test:load:export`.
- indexer migrations ship with a zero-downtime safety harness: production-sized snapshot dry-runs with lock-duration measurement, CI budget enforcement with an explicit online-strategy override, and exercised rollback (up/down/up) verification.
