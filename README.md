# Invoice Liquidity Network

[![CI](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/actions/workflows/ci.yml/badge.svg)](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/actions/workflows/ci.yml)
[![E2E Nightly](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/actions/workflows/e2e-nightly.yml/badge.svg)](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/actions/workflows/e2e-nightly.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-status.iln.finance-brightgreen)](https://status.iln.finance)

**Turn unpaid invoices into instant liquidity on-chain, on Stellar.***********


i just need to create a draft meaninful pr

# Invoice Liquidity Network (ILN)

[![codecov](https://codecov.io/gh/Nursca/Invoice-Liquidity-Network/branch/main/graph/badge.svg?token=CODECOV_TOKEN)](https://codecov.io/gh/Nursca/Invoice-Liquidity-Network)

Invoice Liquidity Network (ILN) is an open-source, decentralised invoice factoring protocol built on [Stellar](https://stellar.org) using [Soroban](https://soroban.stellar.org) smart contracts. Freelancers, creators, and SMEs unlock the value of outstanding invoices immediately, while DeFi liquidity providers earn yield by funding them at a discount.

No banks. No credit checks. No 60-day waits.

---

i just need to create a draft prrr

## Organisation Repositories

| Repository | Description | Language |
|------------|-------------|----------|
| [Invoice-Liquidity-Network](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network) | 🏠 **This repo** — org overview, shared docs, SDK, CLI, indexer, notifications | TypeScript |
| [ILN-Frontend](https://github.com/Invoice-Liquidity-Network/ILN-Frontend) | 🖥️ Next.js dApp — freelancer dashboard, LP analytics, governance UI | TypeScript |
| [ILN-Smart-Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract) | ⚙️ Soroban smart contracts — invoice lifecycle, multi-token, reputation | Rust |

---

## How It Works

```
Freelancer                  ILN Contract              Liquidity Provider
    |                            |                            |
    |--- submit_invoice() ------>|                            |
    |    (amount, payer,         |                            |
    |     due_date, discount)    |                            |
    |                            |<--- fund_invoice() --------|
    |                            |    (sends USDC at          |
    |<-- receives USDC -------   |     discounted amount)     |
    |   (amount - discount)      |                            |
    |                            |                            |
   ...    invoice due date       ...                          |
    |                            |                            |
  Payer --- mark_paid() -------->|                            |
                                 |--- releases full amount -->|
                                      (LP earns the spread)
```

1. **Submit** — A freelancer calls `submit_invoice()` with amount, payer, due date, and discount rate
2. **Fund** — A liquidity provider calls `fund_invoice()`, sending USDC. The freelancer receives funds immediately
3. **Pay** — The payer settles the invoice, releasing the full amount to the LP
4. **Earn** — The LP earns the discount spread as yield

---

## Stellar Testnet Deployment

| Contract | Contract ID |
|---------|-------------|
| ILN-Distribution | `CAQGPMT3EQK4AABMIR66JJXEOCNCLPTDNXMS5OHZXH4LI24UYAF25V5B` |
| Invoice-Liquidity | `CCPASLHKRFBMVV5PZG3LKDGKFEDXZMB5U7DK42CVLUVWCMUCSRPVBIMO` |
| ILN-Governance | `CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB` |

> Mainnet deployment coming after audit. Do not use with real funds until then.

---

## What's in This Repo

This is the **organisation root** — it contains shared infrastructure used across all ILN sub-projects:

### SDK (`sdk/`)
A typed JavaScript/TypeScript SDK with browser Freighter signing and Node.js keypair support.

```bash
npm install @invoice-liquidity/sdk
```

See [`sdk/README.md`](./sdk/README.md) for full API documentation.

### CLI (`cli/`)
A command-line tool for interacting with the ILN contract on testnet and mainnet.

```bash
npm install -g @invoice-liquidity/cli
```

```bash
iln submit --payer G... --amount 100 --due 2025-12-31 --rate 300
iln fund --id 1
iln pay --id 1
iln status --id 1
```

See [`cli/README.md`](./cli/README.md) for setup and usage.

### Indexer (`indexer/`)
A Node.js service that indexes contract events and exposes a REST API for the frontend.

### Notifications (`notifications/`)
A webhook-based notification service for invoice lifecycle events.

See [`docs/notifications.md`](./docs/notifications.md) for setup.

### Scripts (`scripts/`)
Deployment and development helper scripts.

| Script | Purpose |
|--------|---------|
| `scripts/deploy.ts` | Deploy contract to testnet/mainnet |
| `scripts/fund-wallets.sh` | Fund testnet wallets via Friendbot |
| `scripts/seed.sh` | Seed test data |
| `scripts/dev-setup.sh` | Set up a local dev environment |

---

## Repository Structure

```
.
├── cli/                    # CLI package (@invoice-liquidity/cli)
├── docs/                   # Shared protocol documentation
├── indexer/                # On-chain event indexer service
├── notifications/          # Webhook notification service
├── scripts/                # Deployment & dev scripts
├── sdk/                    # TypeScript SDK (@invoice-liquidity/sdk)
├── tests/                  # E2E integration tests
├── .github/workflows/      # CI/CD pipelines
├── docker-compose.yml      # Local dev environment
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md               # You are here
```

> **Frontend** and **Smart Contract** source code lives in their own dedicated repositories (linked above as git submodules).

---

## Getting Started (Local Dev)

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.74+
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/stellar-cli)
- [Docker](https://docs.docker.com/get-docker/) (for E2E tests)

### Clone with Submodules

```bash
git clone --recurse-submodules https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network.git
cd Invoice-Liquidity-Network

# Or if already cloned:
git submodule update --init --recursive
```

### Start Local Environment

```bash
docker-compose up -d          # Start local Stellar node
npm run test:e2e              # Run E2E integration tests
```

---

## Roadmap

- [x] Core Soroban contract (submit, fund, mark_paid)
- [x] Testnet deployment
- [x] Frontend dApp for freelancers
- [x] LP dashboard with yield analytics
- [x] TypeScript SDK + CLI
- [x] Multi-token support (USDC, EURC, XLM)
- [ ] Off-chain payer verification oracle
- [ ] Formal security audit
- [ ] Mainnet deployment
- [ ] DAO governance for protocol parameters

---

## Documentation

| Doc | Description |
|-----|-------------|
| [`docs/index.md`](./docs/index.md) | Protocol overview |
| [`docs/tutorials/lp-funding.md`](./docs/tutorials/lp-funding.md) | LP funding tutorial |
| [`docs/governance.md`](./docs/governance.md) | Governance guide |
| [`docs/multi-token.md`](./docs/multi-token.md) | Multi-token support |
| [`docs/notifications.md`](./docs/notifications.md) | Notification system |
| [`docs/api-collection.md`](./docs/api-collection.md) | Horizon and Soroban RPC API collection examples |
| [`docs/local-development.md`](./docs/local-development.md) | Local dev setup |
| [`docs/tutorials/first-invoice.md`](./docs/tutorials/first-invoice.md) | Hands-on invoice submission tutorial |
| [`docs/ci-cd.md`](./docs/ci-cd.md) | CI/CD and deployment environments |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How to contribute |
| [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) | Community standards and guidelines |
| [`SECURITY.md`](./SECURITY.md) | Security policy |

---

## Contributing

We welcome contributions of all kinds — smart contract improvements, documentation, frontend, tests, and research.

Start here: [CONTRIBUTING.md](./CONTRIBUTING.md) for the project-level contribution model, repo decision tree, and Drips Wave guide.

---

## License

MIT — see [LICENSE](./LICENSE)

---

## Built on Stellar

Built on [Stellar](https://stellar.org) and [Soroban](https://soroban.stellar.org).

> This project is not affiliated with Stellar Development Foundation.

## Security

Please refer to our [Security Policy](./SECURITY.md) for information on supported versions and how to report vulnerabilities privately.

## Documentation Site

The ILN documentation is built with [Nextra](https://nextra.site) and deployed to [docs.iln.finance](https://docs.iln.finance).

### Local Development

```bash
cd packages/docs
npm install
npm run dev
