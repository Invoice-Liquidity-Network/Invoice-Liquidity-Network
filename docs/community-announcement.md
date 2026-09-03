# Mainnet Launch Communications & Community Plan

This document outlines the official launch announcement copy, support channels, security incident contact channels, and the maintainer on-call availability schedule for the Invoice Liquidity Network (ILN) mainnet launch.

---

## 1. Launch Announcement Draft

### Title
**Invoice Liquidity Network (ILN) Launches on Stellar Mainnet**

### Body
Today, the Invoice Liquidity Network (ILN) officially deploys to the Stellar mainnet. 

ILN is a decentralized invoice factoring protocol built on Soroban smart contracts. It enables freelancers, contractors, and businesses to tokenize receivables and access instant non-custodial liquidity from liquidity providers (LPs) in USDC, EURC, and XLM.

#### What is live today:
- **Core Invoice Factoring Contracts**: Immutable invoice lifecycle execution, escrow handling, and settlement logic on Soroban.
- **TypeScript SDK & CLI**: Production-ready `@invoice-liquidity/sdk` and `@invoice-liquidity/cli` for programmatic invoice creation, funding, and status querying.
- **Production Indexer**: Real-time event ingestion with GraphQL, REST endpoints, and automated SQLite database backups.
- **Notification Service**: Webhook, Email, and SMS alerts for funding, payment, and due-date events.
- **Decentralized Governance**: Multi-sig administrative quorum and timelock parameter change mechanisms.

#### Honest Framing & Protocol Parameters
As an early-stage DeFi protocol, safety and stability are our top priorities:
- Initial protocol fee rate is set to **1.0%** (100 bps) with max discount rates capped via governance.
- Emergency circuit breaker mechanisms are active and guarded by a multi-sig admin with a strict timelock.
- Users are encouraged to start with small invoice volumes while liquidity pools bootstrap.

#### Getting Started
- **Web App**: _Coming at mainnet launch — will be published at https://iln.finance_
- **Documentation**: [https://docs.iln.finance](https://docs.iln.finance)
- **Source Code**: [https://github.com/Invoice-Liquidity-Network](https://github.com/Invoice-Liquidity-Network)

---

## 2. Official Support & Community Channels

| Channel | Destination / Handle | Purpose | SLA / Response Time |
|---|---|---|---|
| **Discord** | `#general-support` & `#developer-chat` | Community discussions, integration help, general troubleshooting | Within 4 hours during launch window |
| **Telegram** | `https://t.me/InvoiceLiquidityNetwork` | Community announcements & quick user inquiries | Best effort |
| **Developer Forum** | GitHub Discussions (`Invoice-Liquidity-Network`) | Feature proposals, technical RFCs, SDK questions | Within 24 hours |
| **Email Support** | `support@invoiceliquidity.network` | Sensitive billing or user inquiries | Within 12 hours |

---

## 3. Incident Contact & Escalation Path

For security vulnerabilities and emergency operational issues, follow the dedicated escalation channels below:

### Urgent Security Reports
- **Security Email**: `security@invoiceliquidity.network` (Monitored 24/7 with PGP key available in [`SECURITY.md`](../SECURITY.md))
- **GitHub Advisory**: Open a [Private Security Advisory](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/security/advisories/new)
- **Safe Harbour**: Good-faith research is explicitly protected under our [Safe Harbour Policy](../SECURITY.md#safe-harbour).

### Operational Incidents & Outages
- **Live Status Page**: _Coming at mainnet launch — will be published at https://status.iln.finance_
- **Emergency War Room**: Discord `#incident-response` (restricted to core on-call maintainers)

---

## 4. Maintainer Launch Window Availability Plan

During the **Launch Window (Launch Day T-0 through T+7)**, core maintainers operate under a dedicated high-availability rota distinct from steady-state operations.

### Launch Rota Schedule (24/7 Coverage)

| Shift (UTC) | Primary Maintainer | Secondary Maintainer | Domain Focus |
|---|---|---|---|
| **00:00 - 08:00 UTC** | Protocol Lead | Infrastructure Lead | Soroban contracts, RPC stability, Indexer lag |
| **08:00 - 16:00 UTC** | QA / Security Lead | SDK Lead | Transaction signing, SDK integrations, API triage |
| **16:00 - 24:00 UTC** | Governance Lead | Community Lead | Multi-sig operations, Community support, Communications |

### Maintainer Availability Responsibilities
1. **Immediate Pager Triage**: Maintainers must respond to critical PagerDuty/Slack monitoring alerts within **15 minutes**.
2. **Contract Health Verification**: Run periodic health checks on contract state transitions and token balances.
3. **Daily Sync**: Standup every day at 12:00 UTC during the first 7 days to review error budgets, transaction volumes, and support tickets.
4. **Handoff Log**: Shift handoffs must document open issues, RPC status, and any pending pull requests.
