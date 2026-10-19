# On-Call Escalation Matrix & Shift Handoff Checklist (#1329)

This document establishes the operational standard for on-call escalation paths, response SLAs, and rotation handoff verification across the Invoice Liquidity Network.

---

## 1. Escalation Severity Levels & Response SLAs

| Severity | Definition | Acknowledgement SLA | Mitigation SLA | Primary On-Call | Escalation Target |
|---|---|---|---|---|---|
| **SEV-1 (Critical)** | Core contract paused, oracle failure, total payment blockage | ≤ 15 minutes | ≤ 60 minutes | `@sre-oncall` | Security Lead (`@sec-commander`) |
| **SEV-2 (Major)** | Single anchor outage, notifications failure > 2%, indexer lag > 10 | ≤ 30 minutes | ≤ 4 hours | `@backend-oncall` | Infrastructure Lead (`@infra-lead`) |
| **SEV-3 (Minor)** | Non-blocking telemetry drop, docsite latency, transient 429 rate limit | ≤ 4 hours | ≤ 24 hours | `@component-oncall` | Service Maintainer |

---

## 2. Cross-Service On-Call Domain Roster

- **Protocol Core & Soroban Contracts**: Primary: `@contract-oncall` | Secondary: `@Greymantron`
- **Indexer & Event Ingestion**: Primary: `@indexer-oncall` | Secondary: `@backend-lead`
- **Oracle Verification Service**: Primary: `@oracle-oncall` | Secondary: `@sec-commander`
- **Notification Webhooks & Dispatch**: Primary: `@notifications-oncall` | Secondary: `@backend-lead`
- **dApp UI & SDK Client**: Primary: `@frontend-oncall` | Secondary: `@frontend-lead`

---

## 3. Mandatory Shift Handoff Checklist

Before completing an on-call shift transition, outgoing and incoming engineers must verify:

- [ ] **Incident State**: Review all active, resolved, or recently closed incidents in the past 7 days.
- [ ] **Postmortem Action Items**: Verify that all open postmortem action items are assigned with valid due dates.
- [ ] **Alerts & Silences**: Audit Prometheus/Grafana active silences to ensure no critical alerts are suppressed.
- [ ] **Canary & Deployment Status**: Confirm all active service rollouts or canary bakes have stabilized.
- [ ] **Key Rotation & Access**: Confirm incident commander has verified access to emergency circuit-breaker keys.
- [ ] **Communication Check**: Perform test ping in Discord `#incident-response` to verify pager delivery.

---

## 4. Verification

Run automated checklist validation:
```bash
pnpm test:oncall-handoff
```
