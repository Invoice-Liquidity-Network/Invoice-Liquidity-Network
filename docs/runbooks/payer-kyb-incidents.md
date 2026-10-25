# Payer / KYB Incidents Runbook

Operator reference for the oracle-service payer KYB gate and its automated
failover (issues #1238, #1239, #1240). Source of truth:

- KYB failover wiring — `oracle-service/src/index.ts` (`createKybProvider`).
- Health control — `OracleServiceHealth` in `oracle-service/src/types.ts`.
- Failure taxonomy — `oracle-service/src/authorization.ts`
  ([payer authorization failures](./payer-authorization-failures.md)).

A KYB (Know-Your-Business) check is a **blocking gate**: an explicit rejection
denies the verdict. This runbook is about the two ways that gate can misbehave
in production — the registry is *unreachable* (an outage), or a rejection must
never be silently *bypassed* — and how to tell them apart.

## What the control does

`createKybProvider` wraps the configured `kybProvider` in the same
primary/secondary failover as the indexer and the reputation RPC, but with a
stronger safety property:

- **Failover rescues, never overrides.** A source is switched only when the
  primary *throws* (registry unreachable). A primary that *answers* — even with
  `isVerified: false` — has produced a verdict, so the fallback is never
  consulted. A failover can therefore never turn an explicit KYB rejection into
  an approval.
- **Solo is unchanged.** With no `kybFallbackProvider`, the provider is passed
  through untouched and registers no failover bookkeeping.
- **Fail closed.** When `requireKyb` is set and no source answers, the verdict
  is denied with `rejected-kyb-unavailable` / `PAYER_KYB_UNAVAILABLE` rather
  than published unverified.
- **Redacted by default.** Payer addresses and KYB evidence (business name,
  registration number, signals) are kept out of log lines (#1239). See
  [§ Logs](#logs).

The tracker source ids are `kyb-primary` and `kyb-fallback`. Transition rules,
thresholds and anti-flapping behaviour are shared with the other feeds and
documented in [the source failover runbook](../oracle-source-failover-runbook.md#12-decision-criteria-defaults-in-defaultsourcefailoverconfig).

## The operator control: `health()`

The KYB posture is part of the health payload on `GET /health` and
`GET /v1/health`. It is the control — an incident responder should never have to
read logs or guess:

```jsonc
{
  "status": "degraded",
  "kyb": { "required": true, "configured": true, "failover": true },
  "sources": {
    "kyb-primary": "unavailable",
    "kyb-fallback": "healthy"
  }
}
```

| Field | Meaning |
| --- | --- |
| `kyb.required` | `requireKyb` is on: a positive verdict needs a live KYB check. |
| `kyb.configured` | A `kybProvider` is wired in. If `false`, KYB never blocks. |
| `kyb.failover` | A `kybFallbackProvider` is armed. |
| `sources["kyb-primary"]` | Primary registry state: `healthy` / `degraded` / `unavailable`. |
| `sources["kyb-fallback"]` | Fallback registry state, present only when failover is armed. |

`status` flips to `degraded` whenever any source is `unavailable`.

> **Do not confuse the two `false` verdicts.** `kyb.required: false` means the
> deployment is not gating on KYB at all. `isVerified: false` on a *response*
> means the payer was checked and denied. A `degraded` status means routing
> moved — it does not mean honest payers are being refused, because the fallback
> is serving them.

## Symptoms and triage

Match the verdict's `composition.outcome` and `authorization.primary` code.

| Observation | Cause | Action |
| --- | --- | --- |
| `rejected-kyb-unverified` / `PAYER_KYB_UNVERIFIED` | The registry answered and rejected the payer. | **Policy, not an incident.** The business must resolve with the provider. Do not retry. |
| `rejected-kyb-unavailable` / `PAYER_KYB_UNAVAILABLE` | `requireKyb` is on and no source answered. | Registry outage. Check `sources["kyb-primary"]`, then the provider status. Retryable. |
| `health().status == "degraded"` with `sources["kyb-primary"] == "unavailable"` | Primary registry is down; fallback is serving. | No action if fallback is `healthy` — failover is doing its job. Investigate the primary. |
| `sources["kyb-fallback"] == "unavailable"` and primary unavailable | **Both** registries down. | Honest payers are being refused. Fail over deliberately or drop `requireKyb` (see below). |
| `kyb.required: false` but payers expect KYB | KYB gating is off (e.g. not `NODE_ENV=production` and `requireKyb` unset). | Set `requireKyb` and restart. |
| `kyb.configured: false` | No provider wired; the gate is inert. | Wire `kybProvider`; treat every "verified" verdict as unattested. |

## Metrics

Query `/metrics`:

| Metric | Use |
| --- | --- |
| `oracle_failover_events_total{source="kyb-primary"}` | Counts each demotion of the primary. A climbing counter means repeated outages. |
| `oracle_source_health_state{source="kyb-primary"}` | `0` healthy / `1` degraded / `2` unavailable. |
| `oracle_failover_events_total{source="kyb-fallback"}` | The fallback is *also* flapping. |
| `oracle_payer_authorization_failures_total{code="PAYER_KYB_UNAVAILABLE"}` | Volume of fail-closed denials caused by the outage. |

Alert-worthy shapes:

```promql
# Fallback is failing too — honest payers are now being refused.
oracle_source_health_state{source="kyb-fallback"} >= 2

# Sustained fail-closed denials caused by an unavailable registry.
sum(rate(oracle_payer_authorization_failures_total{code="PAYER_KYB_UNAVAILABLE"}[10m])) > 1
```

## Logs

Per #1239, log lines never contain a full payer address or KYB evidence:

- The indexer-unavailable line keeps the stable `indexer unavailable` prefix but
  truncates the payer to eight characters and redacts any Stellar address inside
  the error message.
- Denial events (`oracle.payer_authorization.denied`) truncate the payer to
  eight characters.
- The cache and audit-retention error lines redact addresses before logging.

If you need the resolved payer for a specific dispute, take it from the request
(or the audit trail), not from a log grep.

## Procedure

**1. Detect.** An alert on `PAYER_KYB_UNAVAILABLE` volume, or a `degraded`
`status` with a `kyb-*` source `unavailable`.

**2. Diagnose.** Read `health().kyb` and `health().sources`:

```bash
curl -s "$ORACLE_URL/v1/health" | jq '{status, kyb, sources}'
```

**3. Mitigate.**

- *Primary down, fallback healthy:* none — failover is serving payers. Confirm
  the fallback stays `healthy` and watch `oracle_failover_events_total`.
- *Both down, `requireKyb` on:* this is the only case that refuses honest
  payers. Either point the fallback at a reachable mirror and restart, or, as a
  deliberate, logged decision under the incident channel, set `requireKyb=false`
  and restart to stop fail-closed denials. Re-enable it as soon as a registry
  answers.

**4. Recover / fail back.** Fix the primary. Failback is automatic: traffic
returns after `recoverySuccesses` consecutive successes **and** the cooldown
have elapsed. Do **not** restart to force it — a restart clears the window and
delays recovery. Confirm with `sources["kyb-primary"] == "healthy"` and a
non-climbing `oracle_failover_events_total{source="kyb-primary"}`.

## Verifying the control in an environment

```bash
# 1. Failover armed and primary healthy?
curl -s "$ORACLE_URL/v1/health" | jq '.kyb, .sources'

# 2. A policy rejection returns a policy code (not an outage code).
curl -s -X POST "$ORACLE_URL/v1/verify" -H 'content-type: application/json' \
  -d '{"payer":"G…","amount":"10000000","invoiceId":42}' | jq '.authorization.primary'
# → "PAYER_KYB_UNVERIFIED"

# 3. CI evidence for the failover semantics.
pnpm --filter @iln/oracle-service exec vitest run src/kybFailover.test.ts src/logDisclosure.test.ts
```

## Ownership and escalation

- **Owner:** Oracle Service team. The gate lives in `oracle-service`; changes to
  `createKybProvider` or the health control require this runbook to be updated
  in the same pull request.
- **Escalation:** follow [incident response](./incident-response.md) for paging
  and sev assignment. A sustained `PAYER_KYB_UNAVAILABLE` with both sources
  `unavailable` is a payer-impacting incident (honest payers refused).

## Related

- [Source failover & delta-bound runbook](../oracle-source-failover-runbook.md)
- [Payer authorization failures](./payer-authorization-failures.md)
- [Incident response](./incident-response.md)
