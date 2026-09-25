# Chaos Engineering

A harness for injecting network partitions, latency and connection failures
between the indexer, oracle-service and notifications, plus a scheduled suite
that checks the resilience behaviour those services claim actually holds under
those faults. Everything lives in `tests/chaos/`.

## How it works

[Toxiproxy](https://github.com/Shopify/toxiproxy) sits on every inter-service
link when the stack is started with the chaos overlay:

```
oracle-service ──INDEXER_BASE_URL──────▶ toxiproxy:18001 ──▶ indexer:3001
indexer        ──RPC_URL───────────────▶ toxiproxy:18000 ──▶ stellar-node:8000
notifications  ──NOTIFICATIONS_RPC_URL─▶ toxiproxy:18002 ──▶ stellar-node:8000
```

`tests/chaos/docker-compose.chaos.yml` re-points the environment variables the
services already read, so no service code changes for chaos runs. The
Toxiproxy API (port 8474) is what the harness drives:

- **partition**: disable a proxy; connections are refused
- **latency**: add a `latency` toxic (with jitter)
- **connection failures**: `reset_peer` (RST after a delay, with a toxicity
  ratio so only a share of connections is hit), `slicer` (fragmentation),
  `timeout`, `bandwidth`, `limit_data`

The runner (`tests/chaos/runner.ts`) executes each scenario: inject the fault,
sample the probes every few seconds for the scenario's duration, heal the link
(always, in a `finally`), then poll until the recovery expectations pass or the
recovery timeout elapses. Toxiproxy is reset at the end of the suite no matter
what happened.

## Scenarios

| Scenario | Fault | What must hold |
|---|---|---|
| `indexer-partition` | oracle → indexer link disabled for 45s | oracle `/v1/health` stays 200 (`ok` or `degraded`); `/v1/verify` never returns 5xx and answers within 6s for ≥90% of samples; health back to `ok` and verify 200 within 60s of healing |
| `indexer-latency-2s` | 2s ± 500ms on every oracle → indexer request | no 5xx, verify within 6s (≥90%), health 200; verify back under 2s after healing |
| `indexer-connection-resets` | half the connections reset after 500ms, the rest fragmented | no 5xx, health 200; verify 200 after healing |
| `rpc-outage-indexer` | indexer → Soroban RPC disabled for 60s | `/health` answers 200 or 503 with `db: ok`; back to 200 / `status: ok` within 120s |
| `rpc-latency-notifications` | 3s latency on notifications → RPC | `/health` and `/health/providers` stay 200 during and after |

These encode the degraded-mode contracts of the services: the oracle's history
provider returns an empty history when the indexer is unreachable and verdicts
degrade to low confidence instead of failing; the indexer poller logs and
retries instead of exiting; notifications keep serving while the chain lags.

## Running

```bash
pnpm chaos:up                       # stellar-node, redis, toxiproxy, indexer, oracle-service, notifications
pnpm chaos:run                      # all scenarios; writes .chaos/chaos-report.{json,md}; exit 1 on failure
CHAOS_SCENARIOS=indexer-partition,rpc-outage-indexer pnpm chaos:run
CHAOS_TIME_SCALE=0.2 pnpm chaos:run # quick smoke run (durations × 0.2)
pnpm chaos:down
```

Endpoints default to localhost; override with `CHAOS_TOXIPROXY_URL`,
`CHAOS_ORACLE_URL`, `CHAOS_INDEXER_URL`, `CHAOS_NOTIFICATIONS_URL` to point the
harness at a remote staging deployment that has Toxiproxy on its links.
`CHAOS_CONTRACT_ID` sets the contract the notifications poller watches.

`pnpm test:chaos` runs the harness's own unit tests (fake Toxiproxy API, fake
probes, no containers) and is what pull requests run. `pnpm test:chaos:live`
is the same suite as `chaos:run` in vitest form; it is skipped unless
`CHAOS_TOXIPROXY_URL` is set.

## Schedule and alerting

`.github/workflows/chaos.yml` runs the live suite nightly at 03:00 UTC and on
demand (`workflow_dispatch` with an optional scenario subset and time scale).
The Markdown report goes to the job summary; the JSON report with every sample
and the service logs are uploaded as an artifact. A nightly failure opens a
GitHub issue labelled `incident,chaos` and posts to the Discord webhook when
`DISCORD_WEBHOOK` is configured, the same channels the CI failure
notifications use. A failed scenario is a regression in a resilience claim and
should be treated like a failing test, not a flaky one: the report names the
probe, the check and the pass ratio.

## Adding a scenario

1. Add an entry to `SCENARIOS` in `tests/chaos/scenarios.ts`: the proxy
   (`rpc-indexer`, `indexer-upstream`, `rpc-notifications`), the fault
   (`partition` or a list of toxics), durations, and expectations for the
   `during` and `recovery` phases. Every scenario needs at least one recovery
   expectation; `validateScenarios` refuses to run a catalogue without one.
2. If the scenario needs a new observation, add a probe to `PROBES` in
   `tests/chaos/probes.ts` and its name to `PROBE_NAMES`. Probes never throw;
   a connection failure is a sample with `status: null`.
3. If it needs a new link, add a proxy to `tests/chaos/toxiproxy.json`, publish
   its port in the compose overlay, re-point the consuming service's URL, and
   add the name to `PROXY_NAMES`.
4. `pnpm test:chaos` validates the catalogue structurally; run the scenario
   live once with `CHAOS_SCENARIOS=<name> pnpm chaos:run` before relying on it.

Checks available for expectations: `status` (any of a list), `no5xx`,
`latencyBelowMs`, and `jsonField` (a dotted path in the JSON body must equal
one of the listed values). `minPassRatio` lets a `during` expectation tolerate
a share of failed samples where the fault itself makes some failures legitimate.
