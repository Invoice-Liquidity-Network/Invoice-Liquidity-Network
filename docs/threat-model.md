# ILN Protocol Threat Model

This document covers the protocol-wide attack surface for Invoice Liquidity Network across the SDK, frontend, API layer, and governance process.

It complements the smart contract threat model maintained with the Soroban contracts. Contract-specific risks such as authorization logic, state transitions, and on-chain invariants should be reviewed alongside this document before audit.

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
4. Governance impersonation or maintainer compromise

These risks are acceptable only as long as they remain visible, monitored, and covered by process controls before mainnet expansion.

## 7. Review Requirements

Before merging, this document should be reviewed by at least two maintainers, with one review focused on protocol design and one on implementation or operations.

## References

- [Stellar XDR](https://developers.stellar.org/docs/learn/fundamentals/data-format/xdr)
- [Horizon XDR fields](https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/xdr)
- [Transactions and envelopes](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions)
- [Stellar RPC](https://developers.stellar.org/docs/data/rpc)
- [Horizon rate limiting](https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting)
- [OWASP Content Security Policy Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [OWASP Clickjacking](https://owasp.org/www-community/attacks/Clickjacking)
