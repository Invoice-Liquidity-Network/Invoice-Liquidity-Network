# Canary Deployment & Automated Rollback (issue #1095)

## What this is, and its current boundary

`indexer`, `oracle-service`, and `notifications` today deploy straight to full
production traffic — this repo has no existing CI/CD pipeline that deploys
those three services (contrast with `deploy.yml`, which deploys the *Soroban
contract*, and `sdk-release.yml`/`release.yml`, which publish npm packages).
They are deployed externally (their `Procfile` and the live URLs monitored in
`.upptimerc.yml` — `indexer.iln.finance`, `oracle.iln.finance`,
`notifications.iln.finance` — are consistent with a platform that deploys from
git directly, configured outside this repository).

Building a traffic-splitting canary requires two things this repo does not
control: the deploy mechanism itself, and a way to route a small percentage of
live traffic to a new version. **This issue closes the half that is this
repo's to own: the decision engine** — bake for a defined window, poll the
canary's real SLIs, and decide promote/rollback/hold — **and the drill that
proves it works**, expressed as a platform-agnostic orchestrator with
pluggable start/promote/rollback hooks. When a deploy pipeline for these three
services is added to this repo (or wired in from wherever they're deployed
today), it plugs into `scripts/canary/rollout.mjs` by supplying three shell
commands; the decision logic and rollback trigger don't need to be
rewritten per platform.

## Canary duration and promotion criteria, per service

Defined in `scripts/canary/policy.mjs`, reusing the exact fast-burn thresholds
already established in `monitoring/prometheus/slo-alerts.yml` / `docs/slos.md`
— a canary is never held to a different correctness bar than production, only
to a faster one (see "Why the thresholds match production but the timing
doesn't" below).

| Service | Bake duration | Poll interval | Rollback trigger |
|---|---|---|---|
| `indexer` | 15 minutes | 60s | error ratio > 1.4% (14× the 0.1% availability budget), **or** p95 latency > 200ms |
| `oracle-service` | 20 minutes (longest — gates `require_oracle_verification`, see `docs/slos.md` §4.2) | 60s | stale-response ratio > 3% (6× the 0.5% freshness budget), **or** p95 verification latency > 1s |
| `notifications` | 15 minutes | 60s | delivery failure ratio > 1.4% (14× the 0.1% delivery-success budget), **or** p95 delivery latency > 5s |

**Promotion criteria:** every poll for the full bake duration must be clean
(no threshold breach). There is no "mostly clean" allowance — a single breach
at any point triggers immediate rollback rather than waiting out the rest of
the bake window (see below).

### Why the thresholds match production but the timing doesn't

Production alerting (`monitoring/prometheus/slo-alerts.yml`) requires a
breach sustained across **two** windows (e.g. 5m *and* 1h) before paging,
because paging on a single noisy sample against 100% of production traffic is
expensive and a 1-hour confirmatory window is an acceptable price for that
noise reduction. A canary inverts that trade: it carries a small, disposable
slice of traffic specifically so that reacting fast to a single bad sample is
cheap, not expensive. `scripts/canary/rollout-decision.mjs`'s `decide()`
therefore rolls back on the **first** breach of any sample, not a sustained
one — see its unit tests in
`scripts/__tests__/canary-rollout-decision.test.mjs` for the exact behavior at
and around each threshold.

## How it works

1. **`scripts/canary/policy.mjs`** — per-service bake duration, poll interval,
   and thresholds (table above).
2. **`scripts/canary/register-target.mjs`** — registers/deregisters the canary
   instance as a Prometheus scrape target via file-based service discovery
   (the `iln-canary` job in `monitoring/prometheus/prometheus.yml`), labeled
   `deployment="canary"` and `service="<name>"`.
3. **`scripts/canary/prometheus-adapter.mjs`** — builds and runs the PromQL
   for a canary-scoped error ratio and p95 latency, reusing the same raw
   counters the production SLO recording rules use, just re-scoped to the
   canary's labels instead of the whole fleet.
4. **`scripts/canary/rollout-decision.mjs`** — pure `decide(policy, samples)`:
   rollback on the first breach; promote once enough clean samples cover the
   full bake window; otherwise hold.
5. **`scripts/canary/rollout.mjs`** — orchestrates the above: registers the
   target, runs the caller-supplied `--start-command`, polls, calls `decide`,
   and on a decision runs `--promote-command` or `--rollback-command`,
   deregisters the target, and logs the outcome to
   [`release-audit/log.jsonl`](../release-audit/README.md) (issue #1096) as
   action `canary-rollout-<service>`.
6. **`scripts/canary/rollout-drill.mjs`** — the required drill. Starts two
   real local HTTP servers (one healthy, one returning a deliberately
   elevated error rate), runs the full orchestrator against each with real
   HTTP sampling (not canned data), and asserts the regressed one is rolled
   back and the healthy one is promoted. Runs in CI on every PR
   (`.github/workflows/ci.yml`, "Root node --test suites" step,
   `pnpm canary:drill`) — no Docker, Prometheus, or cloud credentials needed,
   so it can't silently bit-rot from being too expensive to run.

## Wiring up a real deploy target

Once a deploy mechanism exists for one of these services, invoke:

```bash
node scripts/canary/rollout.mjs \
  --service indexer \
  --prometheus-url https://prometheus.iln.finance \
  --start-command "node scripts/canary/register-target.mjs --register --service indexer --host <canary-host> --port 3001 --metrics-path /metrics && <deploy the canary instance>" \
  --promote-command "node scripts/canary/register-target.mjs --deregister --service indexer && <shift 100% of traffic to the new version, retire the old one>" \
  --rollback-command "node scripts/canary/register-target.mjs --deregister --service indexer && <tear down the canary instance, leave stable untouched>"
```

The commands are intentionally opaque shell strings — whatever the eventual
platform needs (a CLI call, an ssh command, a Terraform apply) goes there
without touching `rollout.mjs` itself.

## Manual run / dry test

```bash
pnpm canary:drill          # the required drill, see above
pnpm test:canary           # unit tests for the decision engine, adapter, and orchestrator
pnpm canary:rollout --service oracle-service --prometheus-url http://localhost:9090 \
  --start-command "echo start" --promote-command "echo promote" --rollback-command "echo rollback"
```
