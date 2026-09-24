# Security Policy

This policy defines the unified security and vulnerability disclosure policy for the entire Invoice Liquidity Network (ILN) ecosystem across all three repositories:
- 🏠 [Invoice-Liquidity-Network](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network) (SDK, CLI, Indexer, Notifications, Documentation, CI/CD)
- ⚙️ [ILN-Smart-Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract) (Soroban Smart Contracts & WASM artifacts)
- 🖥️ [ILN-Frontend](https://github.com/Invoice-Liquidity-Network/ILN-Frontend) (Next.js Web Application & dApp)

This unified policy ensures consistent severity classification, private disclosure channels, safe-harbour commitments, and response timelines across all ILN components.

## Supported Versions

Security fixes are provided for the latest major version of each maintained ILN component. Pre-mainnet deployments are treated as test environments and must not be used with real funds unless the release notes explicitly say otherwise.

| Component | Repository | Supported surface | Notes |
| --- | --- | --- | --- |
| Soroban contracts | `ILN-Smart-Contract` | Latest deployed testnet/mainnet contracts and release candidates | Includes invoice, reputation, governance, upgrade, and token integration logic. |
| SDK and CLI | `Invoice-Liquidity-Network` | Latest published npm major version | Includes transaction construction, XDR handling, signing flows, and browser or Node.js integrations. |
| Indexer | `Invoice-Liquidity-Network` | Latest main branch deployment target | Includes ingestion, SQLite or API storage, REST and GraphQL endpoints, and rate limiting. |
| Notifications | `Invoice-Liquidity-Network` | Latest main branch deployment target | Includes webhook, email, SMS, digest, and WebSocket delivery paths. |
| Frontend | `ILN-Frontend` | Latest main branch deployment target | Includes web UI, wallet connections, and client-side transaction submission. |
| Documentation and CI/CD | `Invoice-Liquidity-Network` | Latest main branch | Includes setup guidance, examples, workflows, and release automation. |

## Reporting a Vulnerability

Please report suspected vulnerabilities privately. Do not open a public issue, discussion, or pull request with exploit details before the maintainers have investigated and shipped any necessary fix.

Use either reporting channel:

- Email: `security@invoiceliquidity.network`
- GitHub: open a private GitHub Security Advisory for the affected ILN repository

Include as much of the following as you can:

- Affected component, version, branch, commit, contract ID, or deployment environment
- Impact summary, including whether funds, signatures, private data, or service availability are affected
- Step-by-step reproduction instructions or proof-of-concept code
- Transaction hashes, logs, screenshots, webhook payloads, API requests, or XDR samples
- Any known limitations, prerequisites, or suggested mitigations
- Your preferred contact details and disclosure timeline constraints

## Vulnerability Classes

The examples below are in scope when they affect ILN confidentiality, integrity, availability, signer safety, protocol accounting, or user funds.

| Component | In-scope vulnerability classes |
| --- | --- |
| Soroban contracts | Reentrancy or callback ordering issues, storage collision or key namespace confusion, authorization bypass, incorrect invoice lifecycle transition, asset escrow accounting bug, unsafe upgrade path, missing circuit breaker, quorum or timelock bypass, precision or basis point calculation error. |
| SDK and CLI | XDR encoding or decoding bugs, signing bypass, signing the wrong network passphrase, transaction simulation mismatch, unsafe secret handling, address validation bypass, replay-prone transaction construction, browser bundle crypto regression. |
| Indexer | SQL injection, API abuse, broken rate limiting, event ingestion poisoning, ledger replay inconsistency, data exposure through REST or GraphQL filters, denial of service through expensive queries, backup or archive leakage. |
| Notifications | HMAC verification bypass, SSRF through webhook URLs, webhook secret leakage, template injection, notification preference bypass, replayable delivery callbacks, email or SMS abuse, unsafe redirect or URL rendering. |
| CI/CD and docs | Release provenance tampering, workflow secret exposure, malicious generated docs, dependency confusion, inaccurate security-critical setup instructions. |

## Severity Classification

| Severity | Typical impact | Initial target |
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

ILN supports good-faith security research. We will not pursue legal action or recommend legal action for research that:

- Avoids privacy violations, destruction of data, degradation of service, and interruption of other users
- Uses the minimum access needed to verify the vulnerability
- Does not move, drain, or permanently lock funds
- Does not disclose details publicly before maintainers have completed coordinated remediation
- Reports findings promptly through the private channels above

Safe harbour does not cover extortion, social engineering, phishing, physical attacks, malware, spam, or attempts to access unrelated third-party systems.

## Bug Bounty and Recognition

ILN does not guarantee bounty payment unless a separate bounty program says otherwise. Valid reports may be eligible for discretionary recognition or reward based on severity, quality of report, and impact.

Researchers who want public credit may be listed in [`HALL_OF_FAME.md`](./HALL_OF_FAME.md) after the issue is fixed and disclosure is approved.
