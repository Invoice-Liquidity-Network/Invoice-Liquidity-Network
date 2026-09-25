# Alert Rule Audit

An audit of every Prometheus alert rule in `monitoring/prometheus/` against the
incident history the repository actually has, with the methodology scripted so
it can be re-run after each postmortem instead of being a one-off review.

## Ground truth

Three sources hold the incident history:

| Source | What it contributes |
|---|---|
| `docs/postmortems/` | Approved postmortems (one so far: the 2026-08-30 cross-repo game-day). Timeline, detection time, which alerts fired. |
| `docs/game-days/` | Exercise records with MTTD/MTTA/MTTR and the alerts that paged. |
| `history/summary.json` | Upptime's per-service `dailyMinutesDown`. This is the only record of real availability incidents: indexer and notifications down for 2 minutes on 2026-08-30, oracle-service down continuously from 2026-08-26 to 2026-08-30. |

They are transcribed into `monitoring/alert-audit/incidents.json`, one entry per
incident with the components involved, what detected it, and the *alert
class* that should have fired. The ledger also records a decision and reason
for every rule the audit touched, so the next audit starts from the previous
one's reasoning rather than from scratch.

## Method

`scripts/alert-audit.mjs` (tests in `scripts/__tests__/alert-audit.test.mjs`)
does the mechanical part on every run:

1. Parse every `*alerts.yml` rule file: alert name, severity, `for`, and the
   metrics its expression references.
2. Collect the metric names each service emits from its `metrics.ts`, plus the
   recording rules. Any rule that references a metric nobody emits can never
   fire and is reported.
3. For each incident, look up the rules registered for its expected alert
   classes. An incident is *covered* if at least one exists. Incidents whose
   gap is explicitly accepted in the ledger (with a reason) are reported but do
   not fail the check.
4. Alert names in an incident's `detectedBy` that are not rules in this
   repository are reported as *ghost alerts*: they exist in someone's memory
   or another repository, not in the rule set.
5. Precision = rules that fired for an incident they cover ÷ rules that fired
   at all. Recall = covered incidents ÷ incidents. Both are computed only from
   this repository's rules; Upptime and frontend alerts are listed separately.

The human part is deciding, per rule, whether the evidence says *noise*,
*duplicate*, *gap* or *fine*. Those decisions live in `ruleDecisions` in the
ledger and appear in the report's Decision column.

```bash
node scripts/alert-audit.mjs            # Markdown report
node scripts/alert-audit.mjs --json     # for dashboards or diffs
node scripts/alert-audit.mjs --check    # CI: fails on unemitted metrics or uncovered incidents
node --test scripts/__tests__/alert-audit.test.mjs
```

The `Alert Rules` workflow runs the check and the tests on every pull request
that touches `monitoring/` or the script.

## Findings

Rules before the audit: 20 (8 in `oracle-service-alerts.yml`, 12 in
`slo-alerts.yml`). Emitted metrics: 33. No rule referenced a metric that is
not emitted, so nothing was structurally dead.

Against the four recorded incidents:

- **None of the 20 rules could have fired for three of them.** The indexer,
  notifications and oracle outages are plain unavailability. Every existing
  rule is a ratio or rate over request counters, and `clamp_min` keeps those
  ratios at zero when a service stops answering. The burn-rate rules are
  correct for their purpose, but the class of incident the repository has
  actually experienced was invisible to them.
- **The one alert that did fire is a ghost.** The game-day record credits
  `OracleServiceLatencyHigh` and `FrontendBadgeErrorSpike`. Neither name exists
  in this repository's rules; the closest, `OracleVerificationLatencyHigh`,
  has a 2s threshold and would not have fired on a cache bug that returned
  fast, wrong answers. The oracle cache incident is an integrity failure with
  no metric behind it, so it stays an accepted gap with a named follow-up:
  emit `oracle_verification_outcome_total{outcome="rejected-invalid-payload"}`
  from the schema check the hotfix added, then alert on it.
- **Two oracle rules duplicated the SLO burn-rate rules** at looser or
  single-sample thresholds: `OracleVerificationLatencyHigh` (static p95 > 2s
  next to `OracleLatencyFastBurn` at the SLO's 1s) and
  `OracleStaleResponsesRising` (`rate > 0`, i.e. one stale verdict in ten
  minutes, next to the freshness burn-rate pair). Both were removed. The
  `slo-alerts.yml` header already said static thresholds had been retired; the
  file it pointed at still contained them.
- **`OracleNoVerifications` joined on `up{job="oracle-service"}`**, a job label
  only the standalone `scrape-oracle-service.yml` produces. Under
  `prometheus.yml` the job is `iln-oracle`, so the `and on(instance)` clause
  never matched and the rule could not fire. It now matches either label, and
  its window is 30 minutes so a quiet evening on testnet does not page.
- **`OracleCacheHitRateLow`** is documented in its own annotation as noisy
  after deploys and Redis restarts; its `for` went from 15 to 30 minutes.
- **Signal 2 in `docs/monitoring.md` specifies indexer lag thresholds**
  (warning > 60s, critical > 300s) and a database-error condition that had no
  Prometheus rule at all, although `iln_cursor_updated_at` and
  `iln_db_errors_total` are exported.

## Changes

New file `monitoring/prometheus/availability-alerts.yml` (registered in
`prometheus.yml`):

| Rule | Severity | Covers |
|---|---|---|
| `ServiceDown` | critical | any `iln-*` or `oracle-service` scrape target down for 2m; would have fired for all three availability incidents |
| `IndexerCursorStale` / `IndexerCursorStaleCritical` | warning / critical | Signal 2 lag thresholds, gated on the indexer being up so `ServiceDown` is the only page during an outage |
| `IndexerDatabaseErrors` | warning | Signal 2 `db: error` |
| `NotificationsFallbackActive` | warning | degraded-mode routing that the delivery SLO cannot see |

`oracle-service-alerts.yml`: removed `OracleVerificationLatencyHigh` and
`OracleStaleResponsesRising`; retuned `OracleNoVerifications` (job label,
30m) and `OracleCacheHitRateLow` (30m).

## Before and after

| | Before | After |
|---|---|---|
| Rules | 20 | 23 |
| Rules referencing unemitted metrics | 0 | 0 |
| Rules that could never match (job label) | 1 | 0 |
| Incidents covered by a rule | 0 of 4 | 3 of 4 (1 accepted gap) |
| Recall | 0% | 75% |
| Precision | n/a: no repository rule has ever fired | n/a |
| Ghost alerts cited by incidents | 2 | 2 (documented; live in other repos) |

Precision stays undefined because the ledger does not yet contain an incident
for which a rule in this repository fired. That is itself the finding: until
the availability rules see a real outage, the only evidence of paging quality
is the postmortem record, which is why the ledger must be updated as part of
filing each postmortem (`docs/postmortems/PROCESS.md`).

## Repeating the audit

1. After a postmortem is approved, add an entry to
   `monitoring/alert-audit/incidents.json`: components, `detectedBy` (exact
   alert names), `expectedAlertClasses`. Add a class to `alertClasses` if the
   incident is of a new kind.
2. Run `node scripts/alert-audit.mjs`. Every incident should either be
   covered or carry an accepted gap with a reason and a follow-up.
3. For every rule that fired: if it did not correspond to a real incident,
   record a `ruleDecisions` entry (`retuned` or `removed`) with the reason.
   For every rule that should have fired and did not, fix the expression and
   record `retuned`.
4. Commit the ledger, rule and report changes together; the `--check` mode in
   CI keeps the two consistent.
