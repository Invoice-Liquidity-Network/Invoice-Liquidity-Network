# Oracle Service Source Failover Runbook

## Decision Criteria
- **Error Rate**: Primary source fails > 5% of requests over 1 minute.
- **Latency**: Primary source takes > 2s consistently over 1 minute.
- **Staleness**: Primary source data is > 5 minutes old.

## Procedure
1. Automated failover switches traffic to the secondary source.
2. Alert is sent to the on-call engineer.
3. Failback occurs automatically when the primary source meets health criteria for 5 continuous minutes.
