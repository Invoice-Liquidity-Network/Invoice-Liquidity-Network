# Oracle Service

Off-chain payer verification for `fund_invoice()`'s `require_oracle_verification`
path. Two independent signals feed one verdict, and the service is held to a
higher coverage bar than the rest of the monorepo because a bug here releases
funds against an invoice that should have been rejected.

## Signal composition

Two signals, answering different questions:

| Signal | Question | Time horizon |
| --- | --- | --- |
| Fraud heuristic | Is this payer's *recent on-chain behaviour* consistent with a legitimate invoice? | Rolling 24h / 30d windows |
| External provider (KYB) | Is this legal entity *who they claim to be*? | Months |

### The policy

**Fraud signals are blocking, and a KYB pass cannot clear them.** A verified
business can still be compromised, coerced, or committing fraud; an identity
attestation says nothing about whether the current burst of near-identical
invoices is real. If KYB could override a fraud flag, the attestation would
become the single most valuable thing to obtain before an attack.

**A missing or negative KYB result is not blocking.** The protocol funds
pseudonymous on-chain payers by design, and most legitimate payers will never
appear in a KYB database. The external signal moves *confidence*, not the
verdict:

| External status | Effect |
| --- | --- |
| `verified` | Confidence bonus (+0.15, scaled by the provider's own confidence) |
| `unverified` | Confidence capped at 0.6 |
| `unknown` | No adjustment at all |

`unknown` is deliberately distinct from `unverified`. A provider that is not
configured, times out, or has no record tells us nothing, and "we could not
check" must never be read as "we checked and they failed" — otherwise a provider
outage silently degrades every verdict in the system.

Confidence still has to clear the same 0.55 threshold, so a capped confidence
*can* flip a marginal verdict to rejected. That is the mechanism by which a weak
external signal tightens the bar without being an outright veto.

### Precedence

1. Stale source data → `rejected-stale-data`
2. Any fraud signal → `rejected-fraud-signals` (KYB cannot clear)
3. Trust or confidence below threshold → `rejected-low-trust`
4. Otherwise → `verified-both` or `verified-heuristic-only`

Staleness outranks fraud only because a stale assessment is not evidence of
anything — reporting a fraud verdict we cannot stand behind would be worse than
declining to answer.

### The response

Every verification carries a `composition` object with both sub-scores, not just
the final boolean, so `OracleBadge` can render the four cases distinctly:

```jsonc
{
  "isVerified": false,
  "confidence": 0.8,
  "composition": {
    "policy": "heuristic-blocking-v1",
    "outcome": "rejected-fraud-signals",
    "rationale": "Fraud heuristics fired. External KYB verification does not clear behavioural fraud signals.",
    "heuristic": { "trustScore": 85, "confidence": 0.8, "confidenceLevel": "high", "fraudSignals": ["..."], "passed": false },
    "external":  { "status": "verified", "provider": "acme-kyb", "providerConfidence": null, "checkedAt": null, "reasons": [] },
    "baseConfidence": 0.8,
    "composedConfidence": 0.8
  }
}
```

`policy` is versioned so stored verdicts stay auditable when the rules change.

### Wiring a provider

`ExternalVerificationProvider` is a plain port — no provider is bundled:

```ts
const { app } = await createOracleApp({
  externalProvider: async (payer) => ({
    status: (await lookupKyb(payer)) ? 'verified' : 'unverified',
    provider: 'acme-kyb',
    providerConfidence: 0.9,
  }),
});
```

A provider that throws is reported as `unknown`, never `unverified`.

## Cache staleness

Verification results are cached, keyed on `payer:amount:invoiceId`. Fraud
heuristics are time-sensitive by construction — rapid-succession and
similar-amount detection both look at rolling windows — so a clean verdict is
only true as of the instant it was computed. Cached for the full 300 s, it
becomes a window in which a payer who has *just* started behaving fraudulently
still reads as clean.

Two mitigations, both in `cache.ts`:

**Asymmetric TTL.** A stale *clean* verdict is a security failure: bad actors
read as good. A stale *flagged* verdict is not: good actors read as bad, which
costs a re-check and fails safe. So clean verdicts for payers with activity
inside the rapid-succession window get 30 s; everything else keeps 300 s. Keeping
the full TTL on flagged verdicts also stops an attacker re-querying to grind out
a clean result.

**Explicit invalidation.** `POST /v1/cache/invalidate { payer }` drops every
cached verdict for a payer. The indexer calls this when it observes new activity,
so a clean verdict cannot outlive the behaviour it was computed from. Redis uses
`SCAN`, not `KEYS`, so invalidation never blocks the Redis event loop.

Callers can also pass `forceRefresh: true` to bypass the cache for a single
request.

## Monitoring

`/metrics` and `/v1/metrics` expose Prometheus text exposition.

| Metric | Type | Purpose |
| --- | --- | --- |
| `oracle_verification_requests_total` | counter | Request volume |
| `oracle_verification_duration_seconds` | histogram | Latency |
| `oracle_cache_hits_total` / `_misses_total` | counter | Cache effectiveness |
| `oracle_stale_responses_total` | counter | Upstream data freshness |
| `oracle_verification_outcome_total` | counter | Verdicts by outcome, external status, cache hit |
| `oracle_fraud_signal_total` | counter | Individual heuristics as they fire |
| `oracle_fraud_flag_ratio` | gauge | Share of the last 200 verdicts carrying a fraud signal |
| `oracle_external_verification_total` | counter | Provider lookups by status |

`oracle_fraud_flag_ratio` exists because the alert that matters — a sudden spike
in fraud-flagged submissions — is a question about the *share* of verdicts, not
the count. Cache hits are excluded from the ratio: they are replays of an earlier
verdict, and counting them would let one flagged payer retrying in a loop page
someone for a single actor.

### Setup

- Scrape config: `monitoring/prometheus/scrape-oracle-service.yml`. The job label
  must stay `oracle-service` — the `OracleNoVerifications` rule joins against
  `up{job="oracle-service"}`.
- Alert rules: `monitoring/prometheus/oracle-service-alerts.yml`.
- Uptime: `.upptimerc.yml` checks `/v1/health`, which reports `degraded` after a
  verification failure. A root check would keep returning 200 through exactly the
  failure worth knowing about.

### Alerts

| Alert | Condition | Severity |
| --- | --- | --- |
| `OracleFraudFlagRateHigh` | 10m avg fraud-flag ratio > 25% | warning |
| `OracleFraudFlagRateCritical` | 5m avg > 60% | critical |
| `OracleNoVerifications` | no verifications for 15m while up | warning |
| `OracleAllVerificationsRejected` | >95% rejected over 10m | critical |
| `OracleStaleResponsesRising` | any stale response in 10m | warning |
| `OracleVerificationLatencyHigh` | p95 > 2s for 10m | warning |
| `OracleCacheHitRateLow` | hit rate < 20% for 15m | warning |
| `OracleExternalProviderUnavailable` | >50% `unknown` for 10m | warning |

A fraud-rate spike is either an attack or a heuristic regression. Check
`oracle_fraud_signal_total` to tell them apart: a single signal dominating points
at a bug, a spread across signals points at an attack.

`OracleNoVerifications` covers the failure a plain uptime check misses — the
service answering `/health` with 200 while verifying nothing.

## Testing

```bash
cd oracle-service
pnpm install --ignore-workspace
pnpm test              # unit tests
pnpm test:coverage     # enforces the 95% gate
```

The 95% threshold lives in `oracle-service/vitest.config.ts`, so local runs
enforce the same bar as CI (`.github/workflows/coverage.yml`). `testFixtures.ts`
is excluded from coverage — it is scaffolding, and counting it would inflate the
figure the gate exists to protect.

oracle-service is not a pnpm workspace member, hence `--ignore-workspace`.
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

### Honest Scoping: What "Payer Verification" Actually Means (#867)

In public protocol narratives and SCF submissions, terms like "payer verification" or "credit assessment" can easily be misinterpreted as full legal Know-Your-Business (KYB) compliance. It is critical to state the exact operational scope honestly:

#### What `oracle-service` Currently Checks:
1. **On-chain Settlement Track Record:** Payment success rate and default rate computed from indexed historical events.
2. **Behavioral Inconsistencies:** Significant percentage deviations between the requested invoice amount and historical averages.
3. **Rapid Succession Abuse:** Burst creation of multiple invoices (3+ in 24 hours) from the same account.
4. **Default Clustering:** Recent concentration of defaults (2+ in 30 days) indicating immediate insolvency or malicious abandonment.
5. **Ledger Timing Anomalies:** Clustered `updated_at` timestamps (4+ in identical ledger windows) indicating potential transaction manipulation.
6. **Soroban Reputation Snapshot:** On-chain reputation scores emitted by protocol contracts.

#### What `oracle-service` Does NOT Check:
1. **Legal Business Existence:** Verification of official corporate registration, business licenses, or jurisdiction registry records (e.g. Delaware Division of Corporations, Companies House).
2. **Beneficial Ownership & Identity (KYC/KYB):** Identification or sanctions screening of company directors, Ultimate Beneficial Owners (UBOs), or authorized signatories.
3. **Real-World Balance Sheet Solvency:** Off-chain bank account balances, audited financial statements, credit bureau scores (Dun & Bradstreet, Experian), or cash flows.
4. **Tax Compliance:** Valid VAT, EIN, or tax registration status.

---

### Pluggable External KYB Provider Architecture (#868)

To bridge the gap between purely behavioral on-chain heuristics and legal entity verification, `oracle-service` provides a pluggable adapter interface:

```typescript
export interface KYBVerificationResult {
  provider: string;
  isVerified: boolean;
  businessName?: string;
  registrationNumber?: string;
  jurisdiction?: string;
  riskScore?: number;
  verifiedAt?: string;
  signals?: string[];
  rawDetails?: Record<string, unknown>;
}

export interface VerificationProvider {
  name: string;
  verifyPayer(
    payerAddress: string,
    metadata?: Record<string, unknown>
  ): Promise<KYBVerificationResult>;
}
```

#### How It Works:
- `OracleVerifier` accepts an optional `kybProvider` implementing `VerificationProvider`.
- When assessing a verification request, `OracleVerifier` executes the external KYB check in parallel with indexer history and Soroban reputation RPC calls via `Promise.allSettled()`.
- If the external KYB provider returns `isVerified: false`, the oracle rejects verification (`isVerified: false`), adds a fraud signal (`External KYB provider verification failed or unverified`), and records the provider's diagnostic signals into the evidence log.
- A reference implementation is provided in `oracle-service/src/kyb/mockProvider.ts` (`MockKYBProvider`), allowing seamless local testing and straightforward production adapter implementations for external vendors (e.g., Middesk, Sumsub, Trulioo).

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
