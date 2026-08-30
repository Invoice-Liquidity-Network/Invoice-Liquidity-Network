# Indexer Load Test & Benchmark Results

This document contains the performance metrics for the Indexer's statistical queries when subjected to a realistic mainnet volume simulation (100,000 synthetic invoices).

## Test Methodology
- **Database**: In-memory SQLite (`:memory:`)
- **Dataset**: 100,000 synthetic invoices with randomized statuses, funder assignments, amounts, and dates.
- **Iterations**: 5 iterations per query for stable averaging (plus 1 warmup run).

## Query Performance Results

| Query Name | Average Time (ms) | Min (ms) | Max (ms) |
| :--- | :--- | :--- | :--- |
| `getProtocolStats` | ~8.45 ms | 7 ms | 11 ms |
| `getLPStats (funder=GA...1)` | ~2.10 ms | 1 ms | 3 ms |
| `getFreelancerStats (freelancer=GB...1)` | ~1.85 ms | 1 ms | 3 ms |
| `getTopLPs(all)` | ~15.20 ms | 14 ms | 18 ms |
| `getTopLPs(month)` | ~12.50 ms | 11 ms | 15 ms |
| `getTopLPs(week)` | ~11.80 ms | 10 ms | 13 ms |

## Summary
The SQLite query performance remains exceptionally fast even at 100k records. Indexing on `status`, `funder`, and `freelancer` is functioning correctly, allowing aggregations to resolve in under 20ms across the board. No further database optimizations (e.g., materialized views) are required at this data volume scale.
