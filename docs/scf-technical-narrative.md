# ILN SCF Technical Narrative

This is the umbrella technical narrative for the Invoice Liquidity Network (ILN),
covering the protocol hardening work delivered across all three repositories:

- 🏠 [Invoice-Liquidity-Network](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network) — SDK, CLI, indexer, notifications, oracle-service, documentation, and CI/CD (this repository)
- ⚙️ [ILN-Smart-Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract) — Soroban smart contracts and WASM artifacts
- 🖥️ [ILN-Frontend](https://github.com/Invoice-Liquidity-Network/ILN-Frontend) — Next.js web application and dApp

It is the technical-implementation companion to the strategic framing in the
[Trust & Liquidity Model](./trust-liquidity-model.md). Where that document
records the design-phase decisions made in response to reviewer feedback, this
document maps the concrete technical work in all three repos onto each concern
the reviewers raised. It summarises rather than duplicates: each section links
to the authoritative, repository-specific documents.

## How to read this document

Each section below is named after one concern from the reviewer feedback.
For each concern it lists the repositories and components involved, the
technical work delivered, and the primary documents that hold the detail.

## 1. Invoice verification

Invoice verification means establishing that an invoice is real, correctly
formed, and belongs to a legitimate lifecycle — before funds are released.

**Contracts repo:** The invoice lifecycle (`submit`, `fund`, `mark_paid`,
`cancel`, `claim_default`) is enforced on-chain with strict state transitions,
amount and due-date validation, and authorization checks. The lifecycle and
its security controls are documented in the contract threat model's scope and
state-machine sections, and validated by the fuzz suite covering
`submit_invoice` input validation.

**Main repo:** The indexer ingests invoice lifecycle events and re-derives
state from canonical network data, recording ledger/cursor markers and exposing
freshness metadata so consumers can tell final state from stale state. Event
ingestion is verified by load tests that confirm correctness under 10x concurrent
subscribers. The oracle service consumes the indexer's history to detect behavioural
signals around invoice creation (see [Default handling](#3-default-handling)). The SDK
validates invoice payload shape and address format before encoding, and
supports offline queuing with tamper-evident re-validation guidance.

**Frontend repo:** The frontend renders invoice data from the indexer and
shows live status, event logs, and settlement state so users can verify the
lifecycle directly rather than trusting a stale view. Invoice state is streamed
in real-time via indexer GraphQL subscriptions, keeping UI state within ledger-block latency.

Primary references:

- Smart contract: [Threat Model](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/threat-model.md), [Storage Layout](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/storage-layout.md), [Events](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/events.md)
- This repo: [Threat Model](./threat-model.md), [Indexer Data Model](./indexer-data-model.md), [SDK Trust Model](./sdk-trust-model.md)
- Frontend: [Architecture](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/dev/docs/architecture.md)

## 2. Payer verification

Payer verification answers two distinct questions: is this payer's recent
on-chain behaviour consistent with a legitimate invoice, and is the legal
entity who they claim to be. The two signals are deliberately not equivalent.

**Main repo:** The `oracle-service` computes a trust score from on-chain
settlement history, detects fraud signals (similar-amount bursts, rapid
succession, default clustering, ledger timing anomalies), and returns a
verdict with confidence and an evidence trail. Fraud signals are **blocking**:
a KYB pass cannot clear them. External KYB verification moves confidence but
never overrides a behavioural fraud flag, and a provider that is unavailable
reports `unknown` — never `unverified`, so a provider outage cannot silently
degrade every verdict.

**Contracts repo:** The contract exposes the payer-verification oracle
interface and registry, with governance-controlled oracle registration. The
`fund_invoice` path can require oracle verification before funding.

**Frontend repo:** The frontend surfaces the verification outcome through
`OracleBadge`, rendering the four distinct verdict cases rather than a single
boolean, so users see *why* a payer was or was not verified.

Primary references:

- This repo: [Oracle Service](./oracle-service.md) (including the honest scoping of what oracle verification does and does not check)
- Smart contract: [Oracle Design](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/oracle-design.md), [Oracle Integration](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/oracle-integration.md)
- Frontend: [Security & SRI policy](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/dev/docs/security.md)

## 3. Default handling

Defaults are where LPs can lose principal, so the protocol's default paths
were a central hardening focus.

**Contracts repo:** `claim_default` returns contributed principal to **all**
partial funders in proportion (fixed in PR #1179), eliminating double-counting of
escrowed funds on LP yield payout. `cancel_invoice` refunds all partial funders
at time-of-cancel rather than at settlement, preventing deadlock. The insurance
pool contract provides optional default protection with premium collection,
dynamic reserve sizing, and claim auditing. Default detection is protected by
a multi-sig timelock so no single actor can declare a false default.

**Main repo:** The oracle flags recent concentrated defaults (2+ within the
30-day lookback) as a **blocking fraud signal** that survives KYB verification,
preventing reputation washing. Real-time default detection in the indexer surfaces
defaults within ledger-block latency so LPs can react immediately. The protocol
economics model documents the LP default-risk exposure, escrow-buffer mechanics,
and worst-case liquidity scenarios (see [`protocol-economics.md` §7](./protocol-economics.md#7-worst-case-liquidity-stress-scenarios)).

**Frontend repo:** LP risk preferences gate the marketplace; invoices with
low-reputation payers are dimmed for risk-averse LPs per their policy
configuration. The insurance pool opt-in and claim flows give LPs a concrete
default-mitigation tool with claim transparency (audit log accessible at `/audit/deliveries`).

Primary references:

- Smart contract: [Threat Model](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/threat-model.md), [Insurance Pool Design](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/insurance-pool-design.md)
- This repo: [Protocol Economics](./protocol-economics.md), [Oracle Service](./oracle-service.md)
- Frontend: [Route Map](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/dev/docs/route-map.md)

## 4. LP risk

LP risk covers the capital exposure LPs take on when funding invoices, and the
mechanisms that let them price and mitigate that exposure.

**Contracts repo:** A fair LP queue uses uniform random selection among tied
reputation scores, preventing front-runner predictability. Reputation scores
drive discount-rate pricing: high-reputation payers clear at lower discount
rates, defaults heavily penalise the payer's score (-5 per default). The
distribution contract expands LP yield surface (direct USDC/EURC/XLM returns);
the insurance pool expands default-protection surface (5% first-loss coverage
for premium-paying LPs).

**Main repo:** The SDK and oracle provide risk-relevant inputs—verified
invoices, payer behavioural signals, and on-chain reputation snapshots from
the reputation contract. Reputation RPC calls fall back to a secondary RPC
provider if the primary is unavailable (no stale reputation == no false
confidence). The economics explainer documents the discount-rate pricing model,
three LP risk classes (default, dispute, expiry/liquidity), and worst-case
stress scenarios (concentrated defaults, oracle staleness, escrow auction failure).
Load-test results confirm the indexer stays within latency SLO even under 10x
concurrent subscribers.

**Frontend repo:** LPs get a marketplace with risk indicator badges,
per-payer risk tier visibility, per-token yield analytics and funding history
charts, insurance pool opt-in with premium and reserve transparency, and a
watchlist feature to track invoices held. LPs configure risk preferences at
signup (default: risk-averse) and can re-tune them any time, filtering the
marketplace by payer reputation band.

Primary references:

- Smart contract: [Reputation Model](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/reputation-model.md), [Oracle Attack Economics](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/oracle-attack-economics.md)
- This repo: [Protocol Economics](./protocol-economics.md), [SDK Trust Model](./sdk-trust-model.md)
- Frontend: [Route Map](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/dev/docs/route-map.md)

## 5. Target market

The reviewer feedback asked for a defensible target market. The strategic
answer lives in the Trust & Liquidity Model: SME suppliers in emerging markets
(LATAM and Southeast Asia) selling to US-based enterprise buyers.

**Technically**, this choice constrains the protocol in concrete ways that the
three repos' work addresses:

- **Currency risk:** Buyers pay in USD-backed stablecoins (USDC) while
  suppliers can disburse through local-currency anchors. The contract supports
  multi-token invoices (USDC, EURC, XLM) so suppliers and buyers can settle in
  the asset that minimises their exposure.
- **Liquidity cold-start:** A First-Loss Provision absorbs the first 5% of any
  default during the cold-start phase, lowering the risk threshold for
  institutional LP onboarding.
- **KYB at scale:** The pluggable KYB provider adapter (in `oracle-service`)
  integrates regulated identity providers without storing sensitive PII
  natively; the frontend and SDK surface verification state without handling
  identity documents.
- **Localised settlement rails:** Anchor-network members handle the final-mile
  local currency disbursement, which the frontend's multi-token wallet flows
  and settlement UX support.

Primary references:

- This repo: [Trust & Liquidity Model](./trust-liquidity-model.md), [Protocol Economics](./protocol-economics.md)
- Smart contract: [Multi-token](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/multi-token.md)
- Frontend: [Mainnet Launch Notes](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/dev/docs/mainnet-launch-notes.md)

## 6. Settlement UX

Settlement is the final-mile experience that determines whether a funded
invoice actually pays out on time.

**Frontend repo:** A dedicated payer settlement page with a one-click settlement
flow, QR-code payer invite link, live due-date countdown, and partial payment
support all reduce friction between invoice maturity and `mark_paid`. Transaction
toasts and GraphQL subscriptions to indexer events stream settlement state with
sub-block latency. Settlement reminders are configurable per-invoice and respect
the payer's notification preferences (digest/email/webhook).

**Main repo:** The SDK builds and submits settlement transactions with signer
identity enforcement and simulation-before-signing; failed simulations surface
the contract error and explain to the payer why their transaction will fail
(e.g., "payer address does not match invoice" or "due date has passed"). The
indexer streams `InvoicePaidEvent` via GraphQL subscriptions for instant UI updates
and cursor-based pagination for history. The notifications service delivers
settlement reminders via webhook, email, SMS, and WebSocket with HMAC-signed
payloads and per-delivery audit logging (queryable at `/audit/deliveries`).

**Contracts repo:** `mark_paid` releases LP principal plus discount in one atomic
operation, fees are deducted at settlement and sent to the protocol treasury,
and the dispute/`appeal_default` path gives payers a recourse channel with
fallback to governance multi-sig review if neither party agrees (timelock-protected).

Primary references:

- Frontend: [Mainnet Launch Notes](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/dev/docs/mainnet-launch-notes.md), [Route Map](https://github.com/Invoice-Liquidity-Network/ILN-Frontend/blob/dev/docs/route-map.md)
- This repo: [Notifications](./notifications.md), [SDK Trust Model](./sdk-trust-model.md)
- Smart contract: [Threat Model](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract/blob/dev/docs/threat-model.md)

## Cross-cutting hardening

Three workstreams cut across all of the concerns above.

### Security and trust

- **Unified security policy:** The root `SECURITY.md` defines one disclosure,
  severity, response, and safe-harbour policy for all three repos, reconciled
  with the per-repo technical documents. See the [Security Documentation Map](#security-documentation-map) below.
- **SDK trust model:** The SDK is scoped as a thin transaction builder; its
  trust assumptions, validation limits, and key-management guidance are
  documented in [SDK Trust Model](./sdk-trust-model.md). Pre-signing validation
  includes address format, amount sanity checks, and due-date ordering.
- **Supply chain security:** SLSA Level 3 provenance attestations are published with
  every SDK release, SBOMs ship as release assets. CI runs gitleaks (credential
  detection), dependency audits, and Snyk scanning on every commit. Audit results
  from [cross-repo incident drills](./cross-repo-dependencies.md) are tracked and
  applied to the hardening backlog.

### Cross-repo coordination

The three-repo hardening batch followed a formal coordination protocol that
maps domain ownership (contracts, oracle, indexer, notifications, frontend)
and de-duplicates work through the `sync:smart-contract`, `sync:frontend`, and
`sync:all` labels. See [Hardening Batch Coordination](./hardening-batch-coordination.md).

### Release readiness

The mainnet launch checklist tracks every readiness requirement with an owner,
status, and evidence link, and the aggregated `CHANGELOG.md` curates the
mainnet-release story across all three repos. See [Mainnet Launch Checklist](./mainnet-launch-checklist.md).

## Security documentation map

Because this repo alone carries several security-adjacent documents, the
following map records their distinct purposes:

| Document | Purpose |
| --- | --- |
| [`SECURITY.md`](../SECURITY.md) | Canonical disclosure policy: supported versions, reporting channels, vulnerability classes, severity, response timelines, safe harbour. |
| [`docs/security-guide.md`](./security-guide.md) | Integrator- and operator-facing security practices: best practices, audit information, provenance verification, incident response. |
| [`docs/security.md`](./security.md) | Navigation stub pointing to `SECURITY.md` and the security guide; kept so existing links resolve. |
| [`docs/vulnerability-disclosure.md`](./vulnerability-disclosure.md) | Entryway for reporters: how to report, expected timelines, severity summary, links to the technical threat models. |
| [`docs/threat-model.md`](./threat-model.md) | Protocol-wide attack surface analysis across SDK, frontend, API/indexer, and governance. |

The contract repo's `SECURITY.md`/`docs/security.md` and the frontend repo's
`SECURITY.md`/`docs/security.md` are component-specific implementations of the
same unified policy.

## References

- [Trust & Liquidity Model](./trust-liquidity-model.md) — strategic framing and design-phase decisions
- [Mainnet Launch Checklist](./mainnet-launch-checklist.md) — release-readiness tracking
- [Hardening Batch Coordination](./hardening-batch-coordination.md) — cross-repo process
- [SDK Trust Model](./sdk-trust-model.md) — SDK-specific trust boundaries
- [Oracle Service](./oracle-service.md) — payer verification internals and honest scoping
- [Protocol Economics](./protocol-economics.md) — economic model and LP risk
- [Threat Model](./threat-model.md) — protocol-wide attack surface
- [Security Guide](./security-guide.md) — integrator/operator security practices
- [Unified Security Policy](../SECURITY.md) — disclosure and response policy
