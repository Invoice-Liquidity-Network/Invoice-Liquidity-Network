- closes #1050
- closes #1049
- closes #1047
- closes #1045

### Changes Made

#### 1. Staleness Detection & Circuit-Breaking (Oracle Service)
- **Circuit Breaker Mechanism:** Implemented a staleness threshold for the upstream reputation (conceptually analogous to a price) feeds. If the `lastActivity` or timestamp of the upstream data sources exceeds the acceptable threshold, the `fetchOnChainReputation` function now explicitly trips a circuit breaker and throws a `StalenessError`.
- **Downstream Protection:** Downstream consumers (SDK, clients) are now protected from consuming frozen or stale verification verdicts, as the API halts and returns an explicit error rather than silently returning a misleading, outdated response.
- **Testing:** Adapted existing staleness test frameworks to ensure the circuit breaker trips appropriately when upstream data timestamps simulate a frozen feed.

#### 2. Multi-Source Aggregation & Outlier Rejection (Oracle Service)
- **Aggregation Pipeline:** The oracle no longer relies on a single upstream data source. The verification pipeline has been enhanced to query multiple independent nodes/sources concurrently.
- **Outlier Rejection:** Implemented Median Absolute Deviation (MAD) filtering. By collecting data (e.g. `score`, `totalPaid`, `lastActivity`) from multiple sources, we reject outliers that diverge beyond a configured tolerance threshold.
- **Quorum Rules:** If sources disagree beyond the maximum tolerance and no quorum can be reached, the oracle flags the result and falls back to a halt state (returning an error), preventing compromised single sources from skewing the aggregated output.

#### 3. Dead-Letter Queue & Replay Tooling (Indexer)
- **DLQ Implementation:** Introduced a dead-letter queue (DLQ) in the indexer's SQLite database (`dlq_events` table). Any malformed or unexpected on-chain event shapes encountered by `processor.ts` are now safely routed to the DLQ instead of silently dropping data or crashing the pipeline.
- **Replay Tooling:** Added `replay.ts`, a dedicated script and utility to fetch pending events from the DLQ, re-process them after handler fixes are deployed, and mark them as processed.
- **Fuzzing & Alerting:** The event processor catches arbitrary parsing errors, ensuring the DLQ ingestion path is robust against unexpected payload shapes.

#### 4. Horizontal Read-Replica Strategy (Indexer)
- **Bounded Staleness & `as-of` Header:** To support horizontal scaling (write-primary with N read-replicas), the indexer API now surfaces an `X-Indexer-As-Of-Block` HTTP header in API responses. This explicitly communicates replica staleness bounds to consumers, allowing them to make correctness decisions based on replication lag.
- **Topology Design:** Documented the read-replica topology, synchronization expectations, and replication-lag budgets in `docs/indexer-data-model.md` and `docs/architecture.md`.
