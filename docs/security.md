# Security

This page is the documentation copy of the ILN security policy. The repository root [`SECURITY.md`](../SECURITY.md) remains the canonical policy for GitHub security reporting.

## Reporting a Vulnerability

Report suspected vulnerabilities privately through one of these channels:

- Email `security@invoiceliquidity.network`
- Open a private GitHub Security Advisory for the affected ILN repository

Do not open a public issue, discussion, or pull request with exploit details before maintainers have investigated and shipped any necessary fix.

Include the affected component, version or commit, contract ID or environment, impact summary, reproduction steps, proof-of-concept code, transaction hashes, logs, webhook payloads, API requests, XDR samples, and any suggested mitigations.

## Supported Components

| Component | Supported surface | Notes |
| --- | --- | --- |
| Soroban contracts | Latest deployed testnet contracts and release candidates | Invoice, reputation, governance, upgrade, and token integration logic. |
| SDK and CLI | Latest published npm major version | Transaction construction, XDR handling, signing flows, and browser or Node.js integrations. |
| Indexer | Latest main branch deployment target | Ingestion, SQLite or API storage, REST and GraphQL endpoints, backups, and rate limiting. |
| Notifications | Latest main branch deployment target | Webhook, email, SMS, digest, and WebSocket delivery paths. |
| Documentation and CI/CD | Latest main branch | Setup guidance, examples, workflows, and release automation. |

## Vulnerability Classes

| Component | In-scope vulnerability classes |
| --- | --- |
| Soroban contracts | Reentrancy or callback ordering issues, storage collision or key namespace confusion, authorization bypass, incorrect invoice lifecycle transition, asset escrow accounting bug, unsafe upgrade path, missing circuit breaker, quorum or timelock bypass, precision or basis point calculation error. |
| SDK and CLI | XDR encoding or decoding bugs, signing bypass, signing the wrong network passphrase, transaction simulation mismatch, unsafe secret handling, address validation bypass, replay-prone transaction construction, browser bundle crypto regression. |
| Indexer | SQL injection, API abuse, broken rate limiting, event ingestion poisoning, ledger replay inconsistency, data exposure through REST or GraphQL filters, denial of service through expensive queries, backup or archive leakage. |
| Notifications | HMAC verification bypass, SSRF through webhook URLs, webhook secret leakage, template injection, notification preference bypass, replayable delivery callbacks, email or SMS abuse, unsafe redirect or URL rendering. |
| CI/CD and docs | Release provenance tampering, workflow secret exposure, malicious generated docs, dependency confusion, inaccurate security-critical setup instructions. |

## Severity and Response Timeline

| Severity | Typical impact | Response commitment |
| --- | --- | --- |
| Critical | Direct theft or permanent lock of user funds; arbitrary contract state mutation; signing bypass that can authorize transactions; exposed production signing secret; unauthenticated administrative action. | Acknowledge within 48 hours, mitigation or fix target within 7 days, coordinated release as soon as safely possible. |
| High | Limited fund loss or temporary lock; privilege escalation; persistent data exposure; exploitable SQL injection; HMAC bypass for trusted webhooks; reliable service-wide denial of service. | Acknowledge within 48 hours, fix target within 14 days. |
| Medium | Localized data exposure; bounded denial of service; incorrect indexer state without fund impact; SDK validation bug requiring user interaction; replay or webhook issue with limited blast radius. | Acknowledge within 48 hours, fix target within 30 days. |
| Low | Defense-in-depth weakness, misleading security documentation, low-impact information disclosure, non-sensitive spoofing, hardening issue without a practical exploit path. | Acknowledge within 5 business days, address in normal maintenance. |

Severity may be adjusted after triage based on exploitability, affected deployments, user interaction requirements, available mitigations, and whether real funds or signing authority are at risk.

## Response Process

1. The security team acknowledges the report and assigns a primary maintainer.
2. Maintainers reproduce the issue, classify severity, and identify affected components.
3. A private fix branch, patch, configuration change, or operational mitigation is prepared.
4. The fix is reviewed by maintainers with relevant component ownership.
5. A release, advisory, or disclosure note is published after affected users have a reasonable update path.

If the report affects multiple ILN repositories, maintainers coordinate the fix privately across those repositories before public disclosure.

## Safe Harbour

ILN supports good-faith security research. We will not pursue legal action or recommend legal action for research that avoids privacy violations, destruction of data, degradation of service, and interruption of other users; uses the minimum access needed to verify the vulnerability; does not move, drain, or permanently lock funds; does not disclose details publicly before coordinated remediation; and reports findings promptly through private channels.

Safe harbour does not cover extortion, social engineering, phishing, physical attacks, malware, spam, or attempts to access unrelated third-party systems.

## Package Provenance

All ILN npm packages, including `@invoice-liquidity/sdk`, `@invoice-liquidity/cli`, and `@iln/sdk`, should be published from GitHub Actions with provenance attestations rather than from a developer workstation.

### Verify With npm

```bash
npm audit signatures @iln/sdk
```

Expected result: npm reports a verified registry signature and a verified attestation for packages published with provenance.

### Verify With GitHub CLI

```bash
npm pack @iln/sdk
gh attestation verify iln-sdk-*.tgz \
  --repo Invoice-Liquidity-Network/Invoice-Liquidity-Network
```

A successful verification prints the workflow run, commit SHA, and attestation metadata for the tarball.

## SDK Trust Model

The [SDK Trust Model](sdk-trust-model.md) documents the trust assumptions, key management guidelines, security assumptions, threat model, and best practices for `@invoice-liquidity/sdk`. It is the authoritative reference for understanding what the SDK validates, what it delegates, and what must be protected outside the SDK — including browser signing via Freighter and backend keypair signing.

This document is cross-linked from the SDK's browser test suite, which validates genuine wallet-extension interaction patterns. Any SDK-level signing bug that could affect frontend wallet security should be caught by the SDK test suite before reaching the frontend.

## Recognition

Researchers who want public credit may be listed in [`HALL_OF_FAME.md`](../HALL_OF_FAME.md) after the issue is fixed and disclosure is approved. ILN does not guarantee bounty payment unless a separate bounty program says otherwise.
