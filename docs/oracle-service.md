# Oracle Service

Off-chain payer verification for `fund_invoice()`'s `require_oracle_verification`
path. Two independent signals feed one verdict, and the service is held to a
higher coverage bar than the rest of the monorepo because a bug here releases
funds against an invoice that should have been rejected.

> **Last reconciled:** 2026-11-20 — verified against
> `oracle-service/src/index.ts`, `verifier.ts`, `composition.ts`, `cache.ts`,
> `sourceFailover.ts`, and `deltaBounds.ts`.

## Signal composition

Two signals, answering different questions:

| Signal | Question | Time horizon |
| --- | --- | --- |
| Fraud heuristic | Is this payer's *recent on-chain behaviour* consistent with a legitimate invoice? | Rolling 24h / 30d windows |
| External identity signal (advisory) | Is this legal entity *who they claim to be*? | Months |

### The policy

**Fraud signals are blocking, and a KYB pass cannot clear them.** A verified
business can still be compromised, coerced, or committing fraud; an identity
attestation says nothing about whether the current burst of near-identical
invoices is real. If KYB could override a fraud flag, the attestation would
become the single most valuable thing to obtain before an attack.

**A missing or negative advisory result is not blocking.** The protocol funds
pseudonymous on-chain payers by design, and most legitimate payers will never
appear in an identity database. This advisory signal moves *confidence*, not the
verdict. It is a different control from the blocking KYB gate described below
(#868), which is only present when a `kybProvider` is explicitly wired:

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

Two outcomes come from KYB, outside the heuristic/external composition above.
If a configured KYB provider (#868) explicitly fails the payer, a passing verdict
becomes `rejected-kyb-unverified`. If a *required* KYB provider does not answer,
the outcome is `rejected-kyb-unavailable`.

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

### Authorization failure taxonomy

Every verdict also carries an `authorization` block, a stable failure code for
each reason the payer was denied (#1232). Error responses carry the same `code`
field. The verifier fails closed: `isVerified: true` is never published
alongside a failure code. For the code table, metrics, alerts and operator
steps, see [Payer Authorization Failures Runbook](runbooks/payer-authorization-failures.md).

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

## Source failover

Indexer history, on-chain reputation, and KYB lookups each support an optional
primary/secondary pair. Failover is engaged only when a secondary is configured;
a solo source keeps its previous direct behavior and registers no health
bookkeeping.

| Source | Primary | Secondary |
| --- | --- | --- |
| Indexer history | `INDEXER_BASE_URL` | `ORACLE_INDEXER_FALLBACK_URL` |
| Reputation RPC | `ORACLE_REPUTATION_RPC_URL` | `ORACLE_REPUTATION_FALLBACK_RPC_URL` |
| KYB registry | `options.kybProvider` | `options.kybFallbackProvider` |

`sourceFailover.ts` owns a per-source sliding window and a
`healthy → degraded → unavailable` state machine. Defaults (all
env-overridable):

| Setting | Default | Demotes when |
| --- | --- | --- |
| Window size | 50 attempts | — |
| Error rate | 50% → degraded, 100% → unavailable | Window rate at or above threshold |
| p95 latency | 1500 ms → degraded | Window p95 above threshold |
| Staleness | 5 min → unavailable | No success in this period |
| Recovery | 5 consecutive successes **and** 60 s cooldown | Anti-flap hysteresis |
| Quorum agreement | 25% of the proposed value | Used by delta bounds, below |

Routing follows the state. A healthy primary takes every call. A demoted
primary in cooldown is bypassed and the secondary leads, with the primary kept
as last resort so a total secondary outage still attempts something. Once the
cooldown elapses, the primary is tried first as the recovery probe; a failed
probe restarts the cooldown.

Two asymmetries are deliberate:

- **KYB failover only rescues an outage.** A primary that *throws* may fall
  through to the secondary. A primary that answers `isVerified: false` is a
  verdict, not an outage, so the fallback is never consulted and an explicit
  rejection cannot be laundered into an approval by a second registry.
- **Reputation failover is total.** If every reputation source is down the
  provider returns a zeroed snapshot instead of throwing; indexer history
  re-throws transport failures so the verifier can apply the degraded-mode
  contract rather than treating "feed down" as "no invoices".

Operators can see routing without reading logs: `/health` and `/v1/health`
publish `sources` (`indexer-primary`, `kyb-fallback`, …) with each source's
state, and `oracle_source_health_state` / `oracle_failover_events_total` carry
the same information to Prometheus. `status` flips to `degraded` while any
source is `unavailable`.

## Delta bounds and source quorum

Every feed the oracle publishes is a per-payer signal stream. A single update
that moves far beyond what the feed has realistically moved in one step is
either a data-integrity incident or an attempt to steer the oracle; publishing
it on the strength of one source is the failure mode the guard exists to stop.

The guarded feeds and defaults (`deltaBounds.ts`) are:

| Feed | Max relative move | Max absolute move | Quorum |
| --- | --- | --- | --- |
| `history` | 50% | 40 points | 2 |
| `reputation` | 50% | 40 points | 2 |
| `external` | 50% | 40 points | 2 |
| `kyb` | 50% | 100 points | 2 |
| `composite-trust` | 25% | 25 points | 2 |

The effective bound is `max(maxAbsoluteDelta, maxRelativeDelta × |last published value|)`,
so small values are not held hostage by the relative term. A source confirms a
proposal when its own reading is within `quorumAgreementTolerance` (25%) of it;
a source that failed or returned nothing never confirms.

Three outcomes, in order:

1. **Within bound** — publish normally. The first observation of a key has no
   previous value and therefore publishes.
2. **Over bound, quorum confirmed** — publish. N independent sources agree on
   the new value, so the move is corroborated rather than trusted blindly.
3. **Over bound, no quorum** — record the update in the review queue and hold.
   A worsening move is still adopted immediately (freezing it out would let an
   attacker publish "clean" while the payer turns fraudulent); an improving move
   is frozen at the last known-good value until a human resolves the hold.

The queue is bounded (default 100, oldest evicted first, never silently
dropped). `GET /v1/oracle/delta-holds` returns the pending holds and counters.
The guard exposes `resolveHeldUpdate(id, 'accepted' | 'rejected')` in-process,
but there is no HTTP resolution route yet — see
[Known limitations](#known-limitations).

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

Cache keys are `oracle:v1:<payer>:<amount>:<invoiceId>` and the default TTL is
`ORACLE_CACHE_TTL_SECONDS` (300 s). Two backends implement the same interface:
memory, and Redis when `REDIS_URL` is set. Redis also writes a separate
last-known-good entry with a 24 h TTL; the memory backend retains its
last-known-good entry for the life of the process. That store is what backs the
degraded-mode contract below — a total source outage serves the last answer
marked stale, not a freshly invented one.

Production should use Redis: the memory backend is per-process, so a restart
loses the last-known-good copy.

## Verdict attestation

Every `POST /v1/verify` response can carry an `attestation`, so a consumer can
attribute a verdict to this oracle without trusting the transport it arrived on:

```typescript
{
  attestation: {
    keyId: string;      // which key signed it
    nonce: string;      // UUID, unique per publication
    issuedAt: number;   // seconds since the epoch
    payload: string;    // the verdict body, JSON, exactly as returned
    signature: string;  // HMAC-SHA256 over "keyId:nonce:issuedAt:payload"
  }
}
```

`payload` is the verdict serialised by the oracle itself, minus the `attestation`
field. Verify those bytes: re-marshalling the response object in another language
will not reproduce them, and the signature will not match.

Keys come from `ORACLE_SIGNING_KEY` (required in production — the service refuses
to boot without it, because an unattributable verdict is the exact risk the
caller is paying the oracle to remove). `ORACLE_SIGNING_KEY_ID` labels the active
key. During a rotation both keys are honoured for
`ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS`, and
`GET /v1/signing/config` publishes the rotation state — `currentKeyId`,
`previousKeyId`, `rotationWindowOpen`, `rotationExpiresAt` — so verifiers can be
configured from the document rather than told out of band. The endpoint returns
503 while signing is unconfigured.

Replay is rejected: `verifySignedUpdate()` keeps every nonce it has accepted for
at least as long as the update stays fresh, and refuses an update whose `issuedAt`
has aged out even if the nonce has been forgotten. A verdict served from cache is
re-attested per request, so a consumer's replay cache counts publications, not
verdicts.

## Audit trail

Every published verdict is appended to a hash-chained, HMAC-signed trail before
the response leaves the process. An append failure fails the request: a verdict
that is served but not recorded is the forensic gap the trail exists to close.

| Route | Purpose |
| --- | --- |
| `GET /v1/audit/entries` | Paged read: `from`, `to`, `payer`, `invoiceId`, `limit` (max 1000), `offset`. `total` counts the rows matching the filters, not the whole trail. |
| `GET /v1/audit/integrity` | Re-derives the chain and every entry's HMAC; 200 when valid, 500 plus the first offending sequence number when not. |

Both are read-only operator surfaces and should sit behind the same boundary as
`/metrics`. A store fault answers 500 rather than hanging.

Integrity reports which class of edit was found, not just that something is
wrong: `brokenAt` (content or hash changed), `badSignatureAt` (content rewritten
and re-hashed), `gapAt` (a row deleted), `columnMismatchAt` (an indexed column
rewritten so a payer disappears from a range query while the payload chain still
verifies), `anchorInvalid` (history truncated above a purge that cannot be
proved).

Tampering is modelled honestly: the threat is write access to the database, not
to the process. Someone who can rewrite rows can also recompute the chain with
the key the service holds, so the chain proves accidental corruption and
deletion, and the HMAC key's secrecy is what makes deliberate forgery by a
database-only attacker detectable. `AuditTrail.verifyWithKey()` exists for
out-of-band verification of a copy of the database with a key the running
service does not have.

Retention is a privacy obligation, not a cleanup convenience: `docs/privacy.md`
§4 caps these logs at one year. The window is enforced at boot and then hourly,
and a purge writes a signed anchor for what it removed so the surviving chain can
still be verified from the middle. The driver is SQLite
(`ORACLE_AUDIT_DB_PATH`), matching the indexer and notifications services; the
in-memory driver is refused outright in production, since a trail that loses its
contents on restart cannot honour the retention window it advertises.

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
| `oracle_audit_integrity_failures_total` | counter | Integrity checks that found a broken chain |
| `oracle_payer_authorization_decisions_total` | counter | Payer checks by allow/deny and stage (#1232) |
| `oracle_payer_authorization_failures_total` | counter | Denials by taxonomy code and category |
| `oracle_payer_authorization_taxonomy_info` | gauge | Always 1; proves the fail-closed control is loaded |

`oracle_audit_integrity_failures_total` only moves when something calls
`GET /v1/audit/integrity`, so there is deliberately no alert rule watching it: a
rule over a counter nobody increments looks protective and stays silent. Run the
check as a scheduled job, or scrape it after an incident, rather than assuming it
is continuous.

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
| `OraclePayerAuthorizationTaxonomyMissing` | instance up without taxonomy gauge for 10m | critical |
| `OraclePayerAuthorizationDependencyDenials` | >10% of checks denied for dependency/internal causes over 10m | warning |

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
pnpm test:chaos        # upstream-outage suite only
pnpm test:coverage     # enforces the 95% gate
```

The 95% threshold lives in `oracle-service/vitest.config.ts`, so local runs
enforce the same bar as CI (`.github/workflows/coverage.yml`,
`oracle-service-coverage` job). `testFixtures.ts` and `chaosUpstream.ts` are
excluded from coverage — they are scaffolding, and counting them would inflate
the figure the gate exists to protect.

`--ignore-workspace` installs this package on its own. It is also a workspace
member (`pnpm-workspace.yaml`), so a root `pnpm install` covers it too; earlier
revisions of this document claimed otherwise.

## Blocking KYB gate (#868, #1234–#1237)

The advisory external signal above is not the same control as the blocking KYB
gate. The gate exists only when `options.kybProvider` is wired; when it is, a
provider that explicitly fails a payer turns a passing verdict into
`rejected-kyb-unverified`, and a *required* provider that does not answer turns
it into `rejected-kyb-unavailable`. The corresponding authorization codes are
`PAYER_KYB_UNVERIFIED` and `PAYER_KYB_UNAVAILABLE`.

`VerificationProvider` is a plain port (`name`, optional `isMock`,
`verifyPayer`). A reference `MockKYBProvider` lives in
`oracle-service/src/kyb/mockProvider.ts` for fixtures only.

### Boot controls

With `NODE_ENV=production` the service refuses to start unless all three hold:

1. an explicit `kybProvider` is configured (#1235);
2. the provider is not flagged `isMock` (#1234); and
3. `requireKyb` is not disabled.

`requireKyb` defaults to `NODE_ENV === 'production'` and can be set explicitly
via the option or by leaving it unset. When true, cached verdicts are not
replayed: every verification performs a live KYB check, because a cached pass
could outlive a registry revocation.

The loaded posture is visible in three places:

- `/health` and `/v1/health`: `kyb: { required, configured, failover }`
- boot log line `oracle.kyb.configured` with the provider name, `required`, and
  `decisionTtlMs`
- `oracle_kyb_config_info{provider,required,decision_ttl_ms}` on `/metrics`, a
  constant-1 gauge proving the control is armed

### Provenance and decision expiry

Every published verdict carries `kybProvenance`:

```typescript
{
  provider: string;
  status: 'verified' | 'unverified' | 'unavailable' | 'not-configured';
  source: 'live' | 'cache';
  checkedAt: string | null;
  ageMs: number | null;
}
```

A recorded decision may be replayed for at most `ORACLE_KYB_DECISION_TTL_MS`
(default 24 h). After that the cached verdict is discarded and the provider is
re-called (`oracle_kyb_revalidations_total{reason}`), including across process
restarts. A decision that cannot be dated is treated as expired. Publications
that replayed a decision are counted by
`oracle_kyb_provenance_total{provider,status,source}`.

### Failover caveat

As described under source failover, the optional `kybFallbackProvider` is only
consulted when the primary *throws*. A fulfilled `isVerified: false` is a
verdict, not an outage, so the fallback is never asked and an explicit rejection
cannot be turned into an approval.

## Degraded-mode contract (#1057)

When no source can be reached the service does not invent a fresh-looking
answer. The contract callers code against is:

| Situation | Response | Meaning for the caller |
| --- | --- | --- |
| Sources healthy | `200`, verdict per composition rules | Proceed normally |
| All sources down, last-known-good cached | `200` with `stale: true`, `degraded: true`, `isVerified: false`, `dataAgeMs`, staleness evidence | **Halt price-dependent operations.** Payload is the most recent cached answer |
| All sources down, nothing cached | `503` with `degraded: true` and `ORACLE_SOURCES_UNAVAILABLE` | **Halt price-dependent operations.** Retry with backoff |
| Process itself dead | Connection refused / timeout | Treat exactly like the 503 row |

This is last-known-good-with-a-flag, not a hard halt inside the service: a
halt-everything rule would turn every indexer blip into a protocol outage, while
a silent fallback would let stale scores pass as fresh. The flag puts the choice
where the business context lives.

Fresh cache hits within the TTL are served normally. On a cache miss (or
`forceRefresh`) with all sources down, the verifier reads the last-known-good
entry, marks it stale/degraded/unverified, increments
`oracle_degraded_responses_total`, and updates
`oracle_last_known_good_age_seconds`. `/v1/health` flips `degradedMode: true` and
counts `degradedResponses`.

## Rate limiting

- Per-IP sliding window, 100 requests per 60 s by default.
- Configurable with `ORACLE_RATE_LIMIT_MAX_REQUESTS` and
  `ORACLE_RATE_LIMIT_WINDOW_MS`; disable with
  `ORACLE_ENABLE_RATE_LIMIT=false`.
- Over the limit returns HTTP 429 with `retryAfter` and the fail-closed
  authorization error body.

## What this service does and does not check

Taken on-chain behaviour and reputation, the service checks:

1. settlement success rate and default rate from indexed history;
2. amount deviation from the payer's historical average;
3. rapid-succession invoice creation;
4. recent default clustering;
5. clustered `updated_at` timestamps; and
6. the optional Soroban reputation snapshot.

It does **not** check legal business existence, beneficial ownership or
sanctions, off-chain balance-sheet solvency, or tax registration. Those require
a KYB provider and remain the provider's attestation, not something this service
verifies itself. This distinction should be preserved in public protocol
narratives and grant submissions (#867).

## Integration with `fund_invoice()`

Soroban contracts cannot make HTTP calls. The verification result is therefore
consumed off-chain: a client, SDK, or LP calls `POST /v1/verify` and uses
`isVerified` (or the composition block) as the input to its funding decision or
its own on-chain argument. The contract must not be described as calling the
oracle. The on-chain reputation contract may be updated after settlement,
feeding future assessments; that is a separate on-chain surface.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `ORACLE_PORT` | 3010 | HTTP server port |
| `INDEXER_BASE_URL` | `http://localhost:3001` | Indexer service base URL |
| `ORACLE_INDEXER_FALLBACK_URL` | (unset) | Secondary indexer for history failover |
| `ORACLE_REPUTATION_RPC_URL` | (unset) | Soroban RPC for on-chain reputation |
| `ORACLE_REPUTATION_CONTRACT_ID` | (unset) | Reputation contract ID |
| `ORACLE_REPUTATION_FALLBACK_RPC_URL` | (unset) | Secondary RPC for reputation failover |
| `ORACLE_CACHE_TTL_SECONDS` | 300 | Base cache TTL; clean volatile verdicts use 30 s |
| `ORACLE_REQUEST_TIMEOUT_MS` | 3500 | HTTP timeout to the indexer |
| `ORACLE_MAX_ORACLE_AGE_MS` | 300000 | Max acceptable data age (5 min) |
| `REDIS_URL` | (unset) | Redis connection string; memory cache otherwise |
| `ORACLE_RATE_LIMIT_WINDOW_MS` | 60000 | Rate-limit window |
| `ORACLE_RATE_LIMIT_MAX_REQUESTS` | 100 | Max requests per window |
| `ORACLE_ENABLE_RATE_LIMIT` | true | Enable rate limiting |
| `ORACLE_NETWORK_PASSPHRASE` | Testnet | Stellar network for reputation reads |
| `ORACLE_RPC_SOURCE` | random keypair | Source account for reputation simulation |
| `ORACLE_SIGNING_KEY` | (unset) | HMAC key for verdict attestations; required in production |
| `ORACLE_SIGNING_KEY_ID` | `v1` | Active signing key label |
| `ORACLE_SIGNING_KEY_PREV` | (unset) | Outgoing key, honoured during rotation |
| `ORACLE_SIGNING_KEY_PREV_ID` | `v1` | Label of the outgoing key |
| `ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS` | 300000 | How long both keys are accepted |
| `ORACLE_SIGNING_KEY_MAX_AGE_MS` | 300000 | Age after which an attestation is stale |
| `ORACLE_AUDIT_KEY` | (dev key) | HMAC key for the audit chain; required in production |
| `ORACLE_AUDIT_DRIVER` | `sqlite` when a path is set, else `memory` | Audit persistence driver |
| `ORACLE_AUDIT_DB_PATH` | (unset) | SQLite file; required in production |
| `ORACLE_KYB_DECISION_TTL_MS` | 86400000 | Max replay age for a recorded KYB decision (24 h) |
| `ORACLE_FAILOVER_WINDOW_SIZE` | 50 | Attempts kept per source |
| `ORACLE_FAILOVER_ERROR_RATE` | 0.5 | Error rate that demotes to degraded |
| `ORACLE_FAILOVER_ERROR_RATE_UNAVAILABLE` | 1 | Error rate that demotes to unavailable |
| `ORACLE_FAILOVER_P95_LATENCY_MS` | 1500 | p95 latency that demotes to degraded |
| `ORACLE_FAILOVER_STALE_AFTER_MS` | 300000 | No-success window that demotes to unavailable |
| `ORACLE_FAILOVER_RECOVERY_SUCCESSES` | 5 | Consecutive successes before recovery |
| `ORACLE_FAILOVER_COOLDOWN_MS` | 60000 | Minimum time before failing back |
| `ORACLE_DELTA_BOUND_<FEED>_RELATIVE` | see table | Per-feed relative movement bound |
| `ORACLE_DELTA_BOUND_<FEED>_ABSOLUTE` | see table | Per-feed absolute movement bound |
| `ORACLE_DELTA_BOUND_<FEED>_QUORUM` | 2 | Confirming sources required for an over-bound move |
| `ORACLE_DELTA_MAX_HELD_UPDATES` | 100 | Review-queue capacity |
| `ORACLE_DELTA_QUORUM_TOLERANCE` | 0.25 | Agreement tolerance for a confirming source |

`<FEED>` is `HISTORY`, `REPUTATION`, `EXTERNAL`, `KYB`, or `COMPOSITE_TRUST`.

## Payer reputation and upstream chaos (#1488, #1489)

**Source of truth.** Payer reputation is read from the `get_reputation` view of
the on-chain contract at `ORACLE_REPUTATION_CONTRACT_ID`, through
`fetchOnChainReputationOrThrow` in `verifier.ts`. No contract in this
repository defines that method, so its schema is reconciled on the oracle side:

| Payload | Behavior |
| --- | --- |
| Well-formed (number, bigint or numeric-string fields) | Mapped to a snapshot |
| Field missing or `null` | Treated as 0 ("no data") |
| Negative value | Clamped to 0, including `total_paid` |
| `score` above 100 | Capped at 100 |
| Present but malformed (NaN, Infinity, boolean, non-numeric or fractional `total_paid`, object) | Throws, so failover tries `ORACLE_REPUTATION_FALLBACK_RPC_URL`; with every source down the provider still returns a zeroed snapshot |
| `last_activity` more than 60 s in the future | Ignored for freshness, so it cannot mask stale history |

**Upstream chaos.** `upstream-outage.test.ts` drives a real socket and now also
covers a slow upstream inside and past the deadline, a partial outage where
only some requests fail, and contradictory sources (perfect reputation with a
defaulting history, and the reverse). None of these verify a payer.

A verdict built while the indexer or reputation source failed is no longer
written to the cache. Before, it overwrote the last-known-good entry and pinned
the degraded rejection for the full TTL after the feed recovered.

Residual risk, needs a maintainer decision:

- With no history and no `last_activity`, `sourceTimestampMs` falls back to
  now, so missing data counts as fresh. The verdict is still rejected for low
  trust.
- Because degraded verdicts are no longer cached, a sustained outage re-queries
  the upstream on every request, bounded by `requestTimeoutMs`.
- Primary and fallback RPC results are not cross-checked; the first source that
  answers wins.

## Known limitations

1. **Reputation is optional.** If no RPC/contract is configured, every payer
   gets a zero reputation score.
2. **Failover is opt-in.** Without a secondary URL (or KYB fallback) there is a
   single source for that dependency; the health tracker registers nothing.
3. **Delta review resolution has no HTTP route.** `GET /v1/oracle/delta-holds`
   exposes the queue, but accepting/rejecting a hold requires an in-process
   `resolveHeldUpdate()` call. The queue itself is in memory and does not survive
   a restart.
4. **In-memory rate limiting** does not persist across restarts; use Redis or a
   shared limiter in multi-instance deployments.
5. **No API-key authentication.** Rate limiting is per IP, not access control.
6. **Fraud thresholds are static.** The similar-invoice, 24 h and 30 d windows
   are not configurable or learned.
7. **A plain-HTTP Soroban endpoint fails silently.** `stellar-sdk` refuses
   insecure RPC URLs unless `allowHttp` is set, and reputation fetch failures
   collapse into a zeroed snapshot. A misconfigured `http://localhost:8000` RPC
   looks like a payer with no reputation; surfacing configuration failures
   distinctly is open work.
8. **Integrity checks are on demand.** Nothing walks the audit chain on a
   schedule, so `oracle_audit_integrity_failures_total` stays at zero until
   `GET /v1/audit/integrity` is called.
9. **The admin surface has no authentication.** `/v1/audit/entries`,
   `/v1/oracle/delta-holds` and `/v1/signing/config` are read-only but expose
   payer addresses and routing state; keep them off the public listener.

## References

- Code entry points: `oracle-service/src/index.ts` (app wiring, health, routes),
  `verifier.ts` (trust score, cache, KYB gate), `composition.ts` (verdict
  policy), `sourceFailover.ts` (health/failover), `deltaBounds.ts` (quorum and
  held updates), `cache.ts` (TTLs and last-known-good), `signer.ts`
  (attestations), `audit-trail.ts` / `audit-store.ts` (hash-chained trail).
- Related issues: #867 (honest KYB scoping), #868 (pluggable KYB), #1051
  (source failover), #1052 (delta bounds and quorum), #1053 (attestation), #1055
  (audit trail), #1057 (degraded mode), #1232 (authorization taxonomy), #1234–
  #1237 (KYB hardening), #1238 (KYB failover), #1240 (payer/KYB posture).

## Feedback & maintenance

Update this document when fraud heuristics or trust weights change, when a
configuration option is added, when cache/failover/quorum policy changes, or
when the blocking KYB gate moves. Runtime behavior is the source of truth; this
document is verified against the code paths listed above, not against an
intended future architecture.
