# ILN Protocol Threat Model

This document covers the protocol-wide attack surface for Invoice Liquidity Network across the SDK, frontend, API layer, and governance process.

It complements the smart contract threat model maintained with the Soroban contracts. Contract-specific risks such as authorization logic, state transitions, and on-chain invariants should be reviewed alongside this document before audit.

This document is part of a deliberately structured set of security-adjacent
documents. For the security documentation map, the unified disclosure policy,
and the reporter-facing entryway, see [Security](../SECURITY.md),
[Security Guide](./security-guide.md), [Security](./security.md), and
[Vulnerability Disclosure](./vulnerability-disclosure.md).

## Scope

In scope:

- SDK consumers and package dependencies
- Browser frontend and wallet integration
- API and indexer services built on Horizon or Stellar RPC
- Governance and maintainer workflows
- Protocol users interacting with invoices, liquidity positions, and payouts

Out of scope:

- Low-level consensus or validator compromise on Stellar
- Physical compromise of user devices
- Bugs that exist only inside the smart contract implementation and do not affect off-chain systems

## Assumptions

- Users sign transactions locally in a wallet or local key management flow.
- Off-chain services can observe and index on-chain events, but they must not be trusted as an authority for balances or final state.
- Every API response, SDK input, and frontend wallet connection should be treated as attacker-controlled until validated.

## Threat Summary

| Layer | Attacker model | Attack vector | Current mitigation | Residual risk |
| --- | --- | --- | --- | --- |
| SDK | Malicious dependency, compromised npm package, or attacker-controlled host app | Dependency injection, prototype pollution, monkey-patched globals, or crafted XDR/transaction objects passed into SDK helpers | Prefer typed helpers, keep transaction construction small and explicit, validate payload shapes before encode/sign, pin dependencies in lockfiles, review transitive dependencies | A compromised application can still misuse the SDK or sign a bad transaction if it trusts unvalidated input |
| SDK | Network attacker or malicious integration partner | XDR manipulation between simulation, signing, and submission | Build/sign/submit from the same validated transaction object, re-decode or re-simulate before submission where practical, reject unexpected source accounts, fees, time bounds, and memo fields | Users can still be tricked into signing a transaction that is syntactically valid but economically harmful |
| Frontend | Malicious browser extension, injected script, or spoofed wallet provider | Wallet injection attacks, fake provider objects, UI redress, or DOM tampering | Strict CSP, no inline script, explicit provider detection, signed transaction preview, display destination and amount before signing, avoid trusting `window` globals blindly | Browser extension compromise remains a high-impact client-side risk |
| Frontend | Cross-site attacker | Clickjacking, open redirect abuse, or form/iframe abuse | `frame-ancestors 'self'` or stricter, `form-action 'self'`, hardened navigation flows, clear origin checks, avoid embedding privileged views | Users can still be socially engineered away from the canonical app URL |
| Frontend | Cross-origin web attacker | CORS misconfiguration or overly permissive credentialed requests | Tight CORS allowlists, no wildcard origins with credentials, server-side auth where needed, separate read-only endpoints from privileged actions | Public read endpoints can still be abused for scraping and traffic amplification |
| API / Indexer | Scripted abuser or botnet | Horizon or RPC query floods, streaming abuse, pagination abuse, cache-busting, or expensive filter permutations | Server-side rate limiting, per-IP quotas, request timeouts, pagination caps, indexed query patterns, and backpressure on streams | Distributed attacks and legitimate high-volume usage can still exhaust shared infrastructure |
| API / Indexer | Attacker trying to manipulate protocol state perception | Feeding stale or partial event data to dashboards, replaying responses, or desynchronising indexers | Source data should be derived from canonical network responses, store cursor/ledger markers, verify latest ledger continuity, and surface freshness metadata | Indexers are still eventually consistent and can lag the chain temporarily |
| API / Indexer | Adversarial client | Horizon RPC abuse via repeated simulation, transaction submission, or event polling | Separate read and write tiers, rate limit simulation and submission, enforce body size limits, log abusive patterns, and prefer self-hosted RPC for critical operations | Public RPC endpoints will always be a shared resource and can be degraded under load |
| API / Indexer | Attacker or oracle provider | Oracle price manipulation, stale price feeds, or price deviation attacks | Cross-reference oracle prices against multiple independent sources, implement circuit breakers for suspicious price deltas, audit oracle provider code and architecture, rate-limit price-update transaction simulation | A sophisticated oracle attack can still exploit windows of time between price updates or coordination failures between oracle sources |
| API / Indexer | Network partition, ledger fork, or chain reorganization | Indexer chain-reorg edge cases, missing ledger continuity checks, partial event ingestion leading to state divergence | Implement ledger-continuity verification, track parentLedgerHash across window boundaries, validate event ordering via transaction ledger sequence numbers, periodic reconciliation against canonical chain state | A ledger reorg affecting the indexer before reconciliation can still lead to temporary state divergence and mis-reporting |
| Governance | Social engineer, impersonator, or malicious contributor | Phishing maintainers, fake “audit” requests, rogue governance links, or PRs that redirect treasury/control | Publicly documented maintainer list, explicit review requirements, off-channel confirmation for privileged actions, branch protection, and provenance checks for releases | Humans remain vulnerable to pressure, urgency, and impersonation |
| Governance | Internal compromise of a trusted maintainer account | Malicious approvals, poisoned release notes, or misleading issue triage | Require at least two maintainer reviews for security-sensitive changes, use short-lived credentials, and verify release artifacts | A multi-account compromise can still bypass process controls |

## 1. SDK Threat Surface

The SDK is a trust boundary because it often becomes the place where user input is transformed into signed transaction payloads.

### 1.1 Dependency injection and package compromise

Attacker model:

- A malicious npm dependency
- A compromised transitive dependency
- A host application that passes in attacker-controlled extensions or callbacks

Attack vector:

- Overriding globals such as `fetch`, `URL`, or crypto helpers
- Supplying crafted callbacks that mutate requests after validation
- Poisoning transaction builders through unexpected object prototypes or nested fields

Current mitigation:

- Keep the public SDK surface minimal and typed
- Validate all externally supplied payloads before encoding or signing
- Avoid relying on implicit ambient state when building transactions
- Lock dependency versions and review dependency updates carefully

Residual risk:

- If the consuming app is compromised, the SDK can still be used to build and sign a harmful transaction
- Supply-chain compromise can bypass review if package integrity checks are not enforced

### 1.2 XDR manipulation

Stellar transactions and related network objects are represented in XDR, and Horizon exposes XDR fields for transaction data.

Attacker model:

- Network attacker altering data in transit for poorly configured clients
- Malicious integrator feeding manipulated XDR into parsing helpers
- User-interface attacker trying to hide or rewrite transaction details before signature

Attack vector:

- Mutating XDR between simulation, user review, and submission
- Swapping destination, amount, memo, fee, or time bounds inside a serialized envelope
- Replaying stale transaction envelopes or metadata into a different context

Current mitigation:

- Re-decode and verify XDR before signing or submitting
- Display the transaction fields that materially affect user intent
- Treat XDR from any untrusted source as opaque until parsed and validated
- Prefer building transactions from known-good inputs rather than accepting raw envelopes

Residual risk:

- A syntactically valid XDR object can still represent a bad deal for the user
- If the user cannot independently verify destination and amount, social engineering remains effective

## 2. Frontend Threat Surface

The frontend is a trust boundary because it mediates wallet connection, transaction review, and governance participation.

### 2.1 Wallet injection attacks

Attacker model:

- Malicious browser extension
- Compromised injected wallet provider
- Clone site that mimics the canonical ILN frontend

Attack vector:

- Replacing or wrapping wallet provider APIs
- Returning forged account data or falsified connection state
- Presenting a fake signing prompt that differs from the actual transaction payload

Current mitigation:

- Use a strict Content Security Policy
- Never trust an injected provider without checking its identity and capabilities
- Show clear transaction intent before signing
- Require users to verify the domain and wallet prompt details

Residual risk:

- Browser extension compromise can defeat most in-browser controls
- A user can still approve an attacker-crafted transaction if they trust the wrong site or provider

### 2.2 CORS and cross-origin abuse

Attacker model:

- Cross-origin web application trying to read private responses
- Malicious script abusing permissive API headers

Attack vector:

- Overly broad `Access-Control-Allow-Origin`
- Credentialed responses exposed to untrusted origins
- Improperly partitioned public and privileged endpoints

Current mitigation:

- Restrict CORS to known origins only
- Avoid wildcard origins when credentials are enabled
- Separate public read paths from authenticated or privileged write paths

Residual risk:

- Public data is still public, so scraping and indexing cannot be fully prevented
- A future misconfiguration can reopen the cross-origin attack surface

### 2.3 CSP and clickjacking

Attacker model:

- Phisher framing the app inside a hostile page
- Script injector exploiting permissive script loading

Attack vector:

- Embedding wallet or governance pages in hidden frames
- Injecting inline scripts or loading third-party script assets
- Redirecting users into a look-alike flow after a successful session

Current mitigation:

- Enforce a restrictive CSP, including `default-src`, `script-src`, `connect-src`, and `frame-ancestors`
- Avoid inline scripts and inline event handlers
- Refuse to be framed by untrusted origins

Residual risk:

- CSP reduces but does not eliminate risk if the app already trusts a compromised script origin
- Users can still be socially engineered to abandon the protected page and visit a clone

## 3. API and Indexer Threat Surface

The API layer is a trust boundary because dashboards, alerts, and analytics often depend on it more than they depend on the chain directly.

### 3.1 Horizon and RPC abuse

Attacker model:

- Botnet or scraping client
- Competitor or malicious user trying to degrade service
- Integration that accidentally or intentionally generates unbounded traffic

Attack vector:

- Flooding transaction simulation endpoints
- Repeated event polling or streaming reconnect loops
- Large pagination scans across invoices, addresses, or history windows

Current mitigation:

- Apply rate limiting and request budgets at the edge
- Cap page sizes, stream fan-out, and request body sizes
- Cache expensive reads where possible
- Monitor 429s, latency spikes, and anomalous query patterns

Residual risk:

- Shared infrastructure can still be degraded by distributed attacks
- Heavy but legitimate usage can look like abuse without careful tuning

### 3.2 Staleness and data integrity

Attacker model:

- Any party relying on stale API output as authoritative state

Attack vector:

- Consuming outdated indexer data as if it were final
- Missing a rollback, ledger gap, or stream interruption
- Building decisions from partial event ingestion

Current mitigation:

- Record the latest ledger or cursor seen by the indexer
- Expose freshness metadata in API responses and dashboards
- Reconcile derived state against canonical chain data when precision matters

Residual risk:

- Off-chain systems are eventually consistent by design
- A stale dashboard can still mislead users into taking a bad action

### 3.3 Oracle Price Manipulation

Attacker model:

- A malicious or compromised oracle provider
- An oracle provider with business incentives misaligned with the protocol
- A network attacker intercepting oracle price updates
- A front-runner observing price feed timing patterns

Attack vector:

- Supplying stale, artificially inflated, or manipulated price feeds for collateral assessment
- Creating temporary price spikes or dips that trigger unintended funding gates or defaults
- Coordinating price feeds across multiple oracles to create artificial consensus
- Exploiting time windows between price updates to push through bad transactions
- Diverging oracle sources such that different integrations see different prices

Current mitigation:

- Cross-reference oracle prices against multiple independent sources (decentralized oracle design)
- Implement circuit breakers that reject price deltas exceeding expected volatility bounds
- Audit oracle provider code, architecture, and incentive structure before integration
- Log and monitor all oracle price updates and the reasoning behind large deltas
- Rate-limit price-update transaction simulation to prevent abuse
- Document the trust assumptions and operational dependencies for each oracle provider

Residual risk:

- A sophisticated oracle attack can exploit windows between price updates or desynchronization between oracle sources
- An oracle provider compromise or incentive misalignment may not be detected in real-time
- Dependent systems (frontend gates, liquidation triggers) can still be misled by coordinated oracle manipulation

### 3.4 Indexer Chain Reorganization and Data Integrity

Attacker model:

- A network partition that causes the Stellar network or indexer to fork
- A ledger reorganization (reorg) due to network-level consensus corrections
- An indexer bug or network condition that causes partial event ingestion or gap
- An attacker replaying stale events or hiding recent events from the indexer

Attack vector:

- Missing or incomplete ledger-continuity checks when ingesting new blocks
- Building derived state without validating that the chain hash linkage is unbroken
- Consuming indexer snapshots without verifying freshness and ancestry
- Partial event ingestion (e.g., invoice submitted but funding missed) leading to state divergence
- Replaying or re-ordering events such that the indexer sees a different timeline

Current mitigation:

- Implement mandatory ledger-continuity verification: validate `parentLedgerHash` at every block boundary
- Track and validate transaction-level ledger sequence numbers and ordering
- Periodically reconcile derived state against the canonical chain (e.g., fetch the latest invoice from Horizon and compare)
- Expose freshness metadata (latest-block-time, latest-transaction-hash) in API responses
- Keep a window of recent ledger hashes to detect and recover from shallow reorgs
- Validate that events are immutable once finalized (e.g., no duplicate or contradictory transactions in the ledger)

Residual risk:

- A ledger reorg affecting the indexer before the next reconciliation pass can lead to temporary state divergence
- Dependent systems relying on stale indexer snapshots may not detect the reorg immediately
- A deep reorg (affecting many ledgers) can cause cascading state corrections across dependent systems

## 4. Governance and Social Engineering

Governance is a trust boundary because attackers often target people before they target code.

### 4.1 Phishing the governance process

Attacker model:

- Impersonator posing as a maintainer, auditor, or ecosystem partner
- Attacker with a convincing but fake emergency story

Attack vector:

- Fake review requests, “urgent audit” links, or spoofed meeting invites
- Malicious proposal descriptions that hide privileged changes
- Social pressure to bypass normal review or merge procedures

Current mitigation:

- Require at least two maintainer reviews for sensitive changes
- Verify high-impact links and identities out of band
- Publish canonical governance and maintainer contact channels
- Treat audit, upgrade, and treasury actions as slow-path operations

Residual risk:

- Social engineering is never fully eliminated
- A rushed maintainer can still approve a malicious action if process discipline slips

## 5. Cross-Reference With the Smart Contract Threat Model

This document intentionally avoids duplicating contract-internal threats.

Use the smart contract threat model to review:

- Authorization and threshold logic
- Asset custody and settlement flows
- State-machine correctness for invoice lifecycle transitions
- Upgrade, admin, and governance-controlled entry points

Use this document to review:

- How users and integrations construct transactions
- How the frontend renders signing intent
- How APIs and indexers expose protocol state
- How maintainers protect the governance process

## 6. Residual Risk Summary

The highest residual risks after the current mitigations are:

1. User-side compromise through browser extensions or phishing
2. Transaction manipulation between construction and signature
3. RPC and indexer abuse that degrades availability
4. Oracle price manipulation and desynchronization between oracle sources
5. Indexer chain-reorg edge cases and temporary state divergence
6. Governance impersonation or maintainer compromise

These risks are acceptable only as long as they remain visible, monitored, and covered by process controls before mainnet expansion.

### Mitigations Cross-Reference

The following new mitigations address the oracle and indexer threat vectors introduced in this refresh:

- **Oracle price manipulation (3.3):** Mitigated by decentralized oracle design, circuit breakers, and cross-source price validation. See `oracle-service/src/fraud-heuristics.ts` for implementation.
- **Indexer chain-reorg attacks (3.4):** Mitigated by ledger-continuity verification, transaction-level validation, and periodic reconciliation. See `indexer/src/ledger-processor.ts` for implementation.
- **Indexer state divergence:** Monitored via freshness metadata and reconciliation alerts. See `indexer/src/state-reconciler.ts` for implementation.

Any residual threat-model entry without a corresponding mitigation or monitoring point is flagged in code review and tracked as a separate issue.

## 7. Review Requirements

Before merging, this document should be reviewed by at least two maintainers, with one review focused on protocol design and one on implementation or operations.

## References

- [SECURITY.md](../SECURITY.md) — vulnerability disclosure policy and severity classification
- [Security Guide](./security-guide.md) — best practices, audit information, and incident response
- [Stellar XDR](https://developers.stellar.org/docs/learn/fundamentals/data-format/xdr)
- [Horizon XDR fields](https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/xdr)
- [Transactions and envelopes](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions)
- [Stellar RPC](https://developers.stellar.org/docs/data/apis/rpc)
- [Horizon rate limiting](https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting)
- [OWASP Content Security Policy](https://owasp.org/www-community/controls/Content_Security_Policy)
- [OWASP Clickjacking](https://owasp.org/www-community/attacks/Clickjacking)
