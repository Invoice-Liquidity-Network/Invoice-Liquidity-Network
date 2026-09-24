# Oracle & Verification Infrastructure

## Overview

The Invoice Liquidity Network's oracle service provides off-chain verification of payer identity and payment history, enabling trustworthy on-chain invoice funding decisions without requiring full KYB (Know Your Business) integration.

This document describes the architecture, trust model, and operational resilience of the oracle service as it stands today—honestly scoped to reflect current capabilities and limitations, not as a polished future state.

## Architecture

### Components

The oracle service (`oracle-service/`) is a Node.js/Express HTTP API that:

1. **Accepts verification requests** — A client sends a payer's Stellar address, invoice amount, and invoice ID
2. **Queries historical invoice data** — Via the indexer service (`indexer/`), retrieves the payer's past invoice settlement record
3. **Fetches on-chain reputation** — Optionally calls a Soroban smart contract to read a reputation score stored on-chain
4. **Computes a trust score** — Analyzes payment history (success rate, default rate, amount patterns) and reputation to produce a fraud-detection assessment
5. **Returns a verification response** — Either "verified" (isVerified: true) or a detailed assessment with confidence levels and fraud signals

### Data Flow

```
Client (SDK/Smart Contract)
         ↓
    Express HTTP API (port 3010)
         ↓
    ┌────────────────────┐
    │  Rate Limiting     │  (per-IP, 100 req/min default)
    └────────────────────┘
         ↓
    ┌────────────────────────────────────────────┐
    │  OracleVerifier (in-memory deduplication)  │
    └────────────────────────────────────────────┘
         ↓
    ┌─────────────────────────────────────┐
    │  Cache (Redis or in-memory)         │
    │  TTL: 300 seconds (configurable)    │
    └─────────────────────────────────────┘
         ↓
    ┌──────────────────────────────────────────┐
    │  Parallel Data Fetch (Promise.allSettled)│
    │  - indexer /v1/history/{payer}          │
    │  - soroban contract.call('get_reputation')│
    └──────────────────────────────────────────┘
         ↓
    ┌────────────────────────────────────┐
    │  assessOracleRequest()              │
    │  - Compute trust score              │
    │  - Detect fraud signals             │
    │  - Estimate confidence              │
    └────────────────────────────────────┘
         ↓
    OracleVerificationResponse
    (JSON with trustScore, confidence, evidence, isVerified)
```

### Key Types & Responses

**OracleVerificationRequest**
```typescript
{
  payer: string;                    // Stellar address
  amount: string | number | bigint; // Invoice amount
  invoiceId: string | number;       // Invoice identifier
  forceRefresh?: boolean;           // Bypass cache
  requestId?: string;               // Optional request correlator
  maxOracleAgeMs?: number;          // Max acceptable data age
}
```

**OracleVerificationResponse**
```typescript
{
  requestId: string;
  payer: string;
  invoiceId: string;
  amount: string;
  trustScore: number;               // 0–100
  confidence: number;               // 0.0–1.0 (data completeness confidence)
  confidenceLevel: 'low' | 'medium' | 'high';
  isVerified: boolean;              // true if trustScore >= 70 && confidence >= 0.55 && no fraud signals && fresh
  generatedAt: string;              // ISO 8601 timestamp
  dataAgeMs: number;                // Time since latest history/reputation source
  cacheHit: boolean;
  reputationScore: number;          // On-chain reputation (if available)
  historicalSuccessRate: number;    // Past payment settlement rate
  historicalDefaultRate: number;    // Past defaults
  averageHistoricalAmount: string;
  amountDeviation: number;          // % deviation from historical average
  settlementVarianceDays: number;   // Settlement time variance
  fraudSignals: string[];           // Detected risk indicators
  evidence: string[];               // Human-readable assessment rationale
}
```

## Trust & Fraud Detection Model

### Verification Criteria

A response is marked `isVerified: true` if **all** of the following hold:

- **trustScore ≥ 70** — Weighted combination of on-chain reputation (38%), success rate (33%), amount fit (17%), variance fit (12%), minus penalties for defaults and fraud signals
- **confidence ≥ 0.55** — At least moderate data completeness (weighted by history volume, reputation availability, and freshness)
- **No fraud signals** — Assessment detects no risk patterns
- **Fresh data** — dataAgeMs ≤ maxOracleAgeMs (default 5 minutes)

### Fraud Signal Detection

The service scans invoice history for:

1. **Multiple recent similar-amount invoices** — 3+ invoices within 30 days with ±5% of request amount
2. **Rapid succession** — 3+ invoices created within a 24-hour window
3. **Recent concentrated defaults** — 2+ defaults within the 30-day lookback
4. **Clustered ledger updates** — 4+ invoices with identical `updated_at` timestamps (possible ledger manipulation)

Each signal reduces trust score by ~9 points (up to 35-point maximum fraud penalty).

### Numeric Normalization & Edge Cases

**normalizeAmountToNumber()**
- Accepts: `string | number | bigint`
- Converts via `BigInt()` for precision, then to `Number`
- If BigInt conversion fails: falls back to `Number()` parsing
- If both fail: returns 0 or `Number.MAX_SAFE_INTEGER` (conservative fallback)
- **Rationale for MAX_SAFE_INTEGER fallback**: Unparseable amounts may indicate tampering; treating them as "maximally large" is conservative for fraud detection

**normalizeTimestampToMs()**
- Accepts: `number | string | null | undefined`
- If null/undefined or ≤ 0: returns 0
- If < 1e12: treated as seconds, multiplied by 1000
- If ≥ 1e12: treated as milliseconds, returned as-is
- Handles both numeric and string inputs

## Resilience & Operational Characteristics

### Graceful Degradation on Indexer Downtime

If the indexer service (`indexer/` on port 3001) is unavailable or slow:

- The oracle continues to return a response (rather than failing the entire verification)
- History is treated as empty (`[]`), reverting to reputation-only assessment
- The `evidence` array includes: *"Indexer data unavailable; assessment based on on-chain reputation only"*
- `confidence` drops (no history volume to bolster confidence)
- `trustScore` still follows the weighted formula, but relies entirely on on-chain reputation (38% weight) plus default penalties

**Example**: A payer with high on-chain reputation (90/100) but no queryable history will still verify if reputation alone meets the threshold, but with lower confidence and a note in evidence.

**Implementation**: `Promise.allSettled()` ensures a failed indexer fetch doesn't block reputation retrieval or vice versa.

### Rate Limiting

To prevent denial-of-service attacks and probing of the fraud-detection heuristics:

- **Per-IP rate limiting**: 100 requests per minute (configurable via `ORACLE_RATE_LIMIT_MAX_REQUESTS`)
- **Sliding window**: 60-second window (configurable via `ORACLE_RATE_LIMIT_WINDOW_MS`)
- **Response on limit exceeded**: HTTP 429 with `retryAfter` (seconds)
- **Can be disabled**: Set `ORACLE_ENABLE_RATE_LIMIT=false` in environment

### Caching

- **In-memory (default)** or **Redis-backed** (via `REDIS_URL`)
- **TTL**: 300 seconds (configurable)
- **Deduplication**: Concurrent identical requests within the same verification window share a single background fetch (via inflight map)
- **Force refresh**: `forceRefresh: true` in request bypasses cache

### Metrics

The oracle exposes Prometheus metrics on `/metrics`:

- `verification_total` — Count of verification requests
- `verification_duration_seconds` — Histogram of processing time
- `cache_hits_total` — Cache hits
- `cache_misses_total` — Cache misses
- `stale_responses_total` — Responses older than maxOracleAgeMs

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ORACLE_PORT` | 3010 | HTTP server port |
| `INDEXER_BASE_URL` | http://localhost:3001 | Indexer service base URL |
| `ORACLE_REPUTATION_RPC_URL` | (unset) | Soroban RPC endpoint for on-chain reputation |
| `ORACLE_REPUTATION_CONTRACT_ID` | (unset) | Smart contract ID for reputation data |
| `ORACLE_CACHE_TTL_SECONDS` | 300 | Cache TTL in seconds |
| `ORACLE_REQUEST_TIMEOUT_MS` | 3500 | HTTP request timeout to indexer |
| `ORACLE_MAX_ORACLE_AGE_MS` | 300000 | Max acceptable data age (5 min) |
| `REDIS_URL` | (unset) | Redis connection string; if set, uses Redis cache |
| `ORACLE_RATE_LIMIT_WINDOW_MS` | 60000 | Rate limit window in milliseconds |
| `ORACLE_RATE_LIMIT_MAX_REQUESTS` | 100 | Max requests per window |
| `ORACLE_ENABLE_RATE_LIMIT` | true | Enable/disable rate limiting |
| `ORACLE_NETWORK_PASSPHRASE` | (Testnet) | Stellar network for reputation contract |
| `ORACLE_RPC_SOURCE` | (random keypair) | Source account for reputation RPC call |

## Integration with Trust & Liquidity Model

### Relationship to External KYB

This oracle is **not a full KYB replacement**, but a **complementary risk assessment layer**:

- **What it does**: Analyzes historical settlement behavior and on-chain reputation signals to assign a fraud risk score
- **What it doesn't do**: Verify legal identity, tax status, regulatory compliance, or business registration
- **Future integration**: The oracle's assessment and evidence can feed into an external-KYB provider integration (Issue 867 explores this design)

### Use in fund_invoice()

When a smart contract (or SDK) calls `fund_invoice()`:

1. SDK or contract calls `POST /v1/verify` with payer address, amount, invoice ID
2. Oracle returns `trustScore`, `confidence`, and `isVerified`
3. Contract or SDK uses `isVerified` as a gate (or treats the score as input to a more complex rule)
4. On-chain, the reputation contract may be updated post-settlement, feeding future assessments

### Feedback Loop

As invoices are settled (paid or defaulted) and indexed by `indexer/`, subsequent verification calls for the same payer will see updated history, potentially increasing or decreasing their trust score. This creates a continuous feedback loop without requiring manual intervention.

## Testing & Validation

### Unit Tests

- `verifier.test.ts`: Core trust-score computation, fraud signal detection, history/reputation fallback
- `index.test.ts`: HTTP API behavior, caching, rate limiting
- Property-based tests for numeric normalization edge cases

### Property-Based Test Coverage

- `normalizeAmountToNumber()`: valid strings, bigints, numbers; extreme values; malformed inputs; fallback behavior
- `normalizeTimestampToMs()`: second vs. millisecond detection; null handling; positive/negative values

### Operational Testing

- Load tests: Verify concurrency handling, cache hit rates, and rate limiting behavior
- Downtime simulation: Confirm graceful degradation when indexer is unavailable

## Degraded-Mode Contract — Issue #1057

When oracle-service cannot reach **any** source (indexer history *and* on-chain
reputation both fail), it does not invent a fresh-looking answer. The contract
integrators code against is:

| Situation | Response | Meaning for the caller |
|---|---|---|
| Sources healthy | `200`, `isVerified` per trust rules | Proceed normally |
| All sources down, last-known-good cached | `200` with `stale: true, degraded: true, isVerified: false`, plus `dataAgeMs` and a staleness evidence entry | **Halt price-dependent operations.** The payload is the most recent cached answer; `dataAgeMs` says how old it is |
| All sources down, nothing cached | `503` with `degraded: true` | **Halt price-dependent operations.** Retry with backoff |
| Oracle process itself dead | TCP connection refused / timeout | Treat exactly like the `503` row: halt and retry |

Design decision: **last-known-good with a staleness flag**, not a hard halt
inside the service. A halt-everything rule would turn every indexer blip into
a protocol outage; a silent fallback would let stale scores pass as fresh.
The flag forces the choice onto the caller, where the business context lives.

Mechanics:

- Fresh cache hits (within `ORACLE_CACHE_TTL_SECONDS`, default 300s) are
  served normally — their staleness is already bounded by the TTL.
- On a cache miss (or `forceRefresh`) with all sources down, the verifier
  reads the last-known-good entry (`getStale`, retained past TTL in memory
  and for 24h in Redis) and marks it stale/degraded/unverified.
- Every degraded response increments `oracle_degraded_responses_total` and
  sets `oracle_last_known_good_age_seconds`; `/v1/health` flips
  `degradedMode: true` and counts `degradedResponses`.
- End-to-end coverage lives in `oracle-service/src/degraded-mode.test.ts`:
  it kills all sources over HTTP and asserts the 503 row, the stale row, the
  health flip, and the Prometheus counters.

## Known Limitations & Future Improvements

1. **Reputation contract optional**: On-chain reputation is currently optional; if not configured, all payers get 0 reputation score
2. **Single RPC source**: Reputation fetches use a single RPC endpoint; future work could add fallback chains
3. **In-memory rate limiting**: Does not persist across process restarts; should be Redis-backed in multi-instance deployments
4. **No API key authentication**: Rate limiting is per-IP only; authenticated API keys could enable per-user limits
5. **Fraud signal heuristics are static**: Thresholds (3 similar invoices, 24-hour window, etc.) are hardcoded; future versions could make these configurable or learned

## References

- **Issues resolved by this documentation**:
  - Issue #876: Write oracle-service architecture and decision documentation for the SCF technical narrative
  - Issue #873: Add rate limiting (implemented)
  - Issue #874: Verify indexer resilience (implemented)
  - Issue #875: Add property-based testing (implemented)

- **Related issues**:
  - Issue #867: Scope honest KYB integration proposal
  - Issue #23: Document rate limiting limits in `docs/oracle-service.md`

- **Code entry points**:
  - `oracle-service/src/index.ts` — HTTP API and app creation
  - `oracle-service/src/verifier.ts` — Trust score computation and fraud detection
  - `oracle-service/src/cache.ts` — Cache abstraction (memory or Redis)
  - `oracle-service/src/metrics.ts` — Prometheus metrics

## Feedback & Maintenance

This document should be updated whenever:
- The fraud signal heuristics or trust score weights change
- New environment variables or configuration options are added
- Rate limiting or caching strategies evolve
- Integration points with external KYB providers are finalized
