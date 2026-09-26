- closes #1045
- closes #1047
- closes #1049
- closes #1050

- Designed horizontal read-replica strategy for the indexer
- Added dead-letter queue and replay tooling for malformed indexer events
- Replaced single-source oracle with multi-source aggregation and outlier rejection
- Added staleness detection with automatic circuit-breaking to oracle-service
