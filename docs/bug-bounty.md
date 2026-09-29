# Bug Bounty Program

This repository runs a **pre‑mainnet bug bounty program** to actively incentivize
external security researchers before the protocol goes live.

## Program Scope

### In‑scope components

| Component | Repository | Surface |
|-----------|------------|---------|
| Soroban contracts | `ILN-Smart-Contract` | Invoice, reputation, governance, upgrade, and token integration logic |
| SDK and CLI | `Invoice-Liquidity-Network` | Transaction construction, XDR handling, signing flows, browser or Node.js integrations |
| Indexer | `Invoice-Liquidity-Network` | Ingestion, SQLite or API storage, REST and GraphQL endpoints, rate limiting |
| Notifications | `Invoice-Liquidity-Network` | Webhook, email, SMS, digest, and WebSocket delivery paths |
| Frontend | `ILN-Frontend` | Web UI, wallet connections, client‑side transaction submission |
| Documentation and CI/CD | `Invoice-Liquidity-Network` | Setup guidance, examples, workflows, and release automation |

### Out‑of‑scope items

- Physical security, physical access, or physical theft of devices.
- Social‑engineering attacks against non‑technical staff.
- Issues already covered by an active mainnet bounty program.
- Vulnerabilities that require moving, draining, or permanently locking funds (reports of this nature will be declined under the safe‑harbour policy).

## Severity Taxonomy

The program uses the same severity classification as the unified `SECURITY.md` policy
(Critical / High / Medium / Low), aligned with the project’s response timelines.

| Severity | Typical impact | Initial triage target |
|----------|----------------|----------------------|
| Critical | Direct risk to user funds, contract drainage, or total protocol bypass. | Acknowledge within 48 hours; fix target 7 days. |
| High | Limited fund loss or temporary lock; privilege escalation; persistent data exposure. | Acknowledge 48 hours; fix target 14 days. |
| Medium | Conditional exploits or partial information disclosure; SDK validation bug requiring user interaction. | Acknowledge 48 hours; fix target 30 days. |
| Low | Defense‑in‑depth weakness; misleading security documentation; non‑sensitive spoofing. | Acknowledge 5 business days; address in normal maintenance. |

## Reward Tiers

Rewards are discretionary and capped per severity tier. All amounts are in **USD** (paid via stablecoin or bank transfer within 30 days of fix approval).

| Severity | Reward range | Conditions |
|----------|--------------|------------|
| Critical | $5 000 – $25 000 | Verified exploit that drains funds or bypasses signing authority. |
| High | $2 000 – $10 000 | Reproducible proof-of‑concept with limited blast radius. |
| Medium | $500 – $2 500 | Requires user interaction or conditional exploit. |
| Low | $100 – $500 | Minor hardening issue or misleading documentation. |

A **discretionary multiplier** of up to 2× may be applied for reports of exceptional quality, thoroughness, or that lead to coordinated fixes across multiple components.

## Intake and Triage Process

1. **Report submission** – Send reports to `security@invoiceliquidity.network` **or** open a private GitHub Security Advisory for the affected repository. Include as much detail as possible (see `SECURITY.md` Reporting a Vulnerability section).

2. **Initial acknowledgment** – Security team acknowledges within **48 hours** of receipt (matching the policy in `SECURITY.md`).

3. **Triage** – Maintainers classify severity, reproduce the issue, and identify affected components within **7 days** (Critical/High) or **30 days** (Medium/Low). If the report is a duplicate, the reporter is notified and the finder of the original report is credited.

4. **Fix preparation** – A private fix branch or configuration change is prepared. The researcher may be asked to verify the fix.

5. **Coordinated disclosure** – After the fix is shipped and tested, the vulnerability is disclosed publicly (or via the private advisory) with researcher credit in the `HALL_OF_FAME.md`.

6. **Bounty payment** – Once the fix is approved, the reward is disbursed within 30 days.

## Selecting and Configuring the Bounty Platform

Pre‑mainnet, the program uses a **self‑hosted process** via GitHub Security Advisories and the `security@invoiceliquidity.network` email address. This avoids third‑party platform fees and keeps the intake channel consistent with the existing vulnerability‑disclosure flow. 

For mainnet, the program may migrate to a dedicated platform (e.g., Immunefi, HackerOne) as the policy and reward budget warrant. The migration path is documented in the program’s annual review.

## Safe Harbour

The same safe‑harbour commitments from `SECURITY.md` apply: good‑faith research that avoids privacy violations, data destruction, service degradation, or fund movement is protected from legal action.

## Links

- `SECURITY.md` – Unified disclosure policy and severity classification.
- `docs/vulnerability-disclosure.md` – Reporter‑facing entryway.
- `HALL_OF_FAME.md` – Researchers who have had verified vulnerabilities fixed and disclosed.