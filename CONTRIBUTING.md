# Contributing to Invoice Liquidity Network

Thank you for your interest in contributing. Invoice Liquidity Network (ILN) is a multi-repository project. This guide explains how the three-repo structure works, where to open issues, how PRs are reviewed, how decisions are made, and how the Drips Wave model works.

---

## Project structure

- [Ways to contribute](#ways-to-contribute)
- [Applying to work on an issue](#applying-to-work-on-an-issue)
- [Project board](#project-board)
- [Development setup](#development-setup)
- [CI/CD pipeline reference](#cicd-pipeline-reference)
- [Submitting a pull request](#submitting-a-pull-request)
- [Branch protection](#branch-protection)
- [Code standards](#code-standards)
- [Automated dependency updates](#automated-dependency-updates)
- [Getting help](#getting-help)
| Repository | Purpose | Typical contributions |
|------------|---------|-----------------------|
| `Invoice-Liquidity-Network` | Project-level repo: shared docs, SDK, CLI, indexer, notifications, repo tooling, developer guides | SDK, CLI, docs, indexer improvements, notifications, repo workflows, shared tests |
| `ILN-Frontend` | Frontend dApp: freelancer dashboard, LP analytics, governance UI, visual polish | UI, UX, styles, React components, frontend integration |
| `ILN-Smart-Contract` | Soroban / Rust smart contracts, on-chain invoice lifecycle, contract tests | contract logic, on-chain validations, Rust tests, protocol security |

This document is the entry point for first-time contributors and for anyone who wants to work across repos.

---

## Where to contribute

Start by choosing the right repo for the issue or improvement.

- **Bug in contract behavior or on-chain logic** → `ILN-Smart-Contract`
- **Visual issue, layout bug, or frontend flow problem** → `ILN-Frontend`
- **SDK, CLI, docs, indexer, notifications, or shared repository tooling** → `Invoice-Liquidity-Network`
- **Governance process, roadmap, coordination, or project-level policy** → `Invoice-Liquidity-Network`
| Label              | Meaning                            |
| ------------------ | ---------------------------------- |
| `help wanted`      | High priority, no funding attached |
| `good first issue` | Well-scoped, good entry point      |
| `in progress`      | Already claimed, do not apply      |

If you are unsure or the work spans multiple repos, open the issue in `Invoice-Liquidity-Network` and clearly explain the affected repo(s). Maintainers will help route it.

---

## Drips Wave contribution model

The Drips Wave system is our project prioritization and complexity model. Every issue is assigned a Wave point value during triage.

### How points are assigned

- `1 point` — small docs updates, typo fixes, minor test cleanups
- `2 points` — small bug fixes, minor frontend polish, SDK/CLI small improvements
- `3 points` — medium bug fixes, new helper behavior, contract interface updates, documentation with code changes
- `4 points` — new feature in one repo, significant UX flow changes, contract + SDK coordination
- `5+ points` — large cross-repo work, major architecture changes, governance or protocol enhancements

Maintainers assign points during issue triage and use them to group work into Waves. If you are new, ask for “Drips Wave points” in the issue comment and maintainers will assign the appropriate complexity level.

### Why it matters

- It helps contributors choose work at the right size
- It makes review and planning easier
- It keeps PRs focused and aligned with project priorities

When you open or apply to work on an issue, include the Wave points if available.

---

## Getting started (first-time contributor)

### Prerequisites

- Node.js 18+
- `pnpm` 9+
- Rust 1.74+
- Docker
- Stellar CLI

### Clone the project with submodules

```bash
git clone --recurse-submodules https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network.git
cd Invoice-Liquidity-Network
git submodule update --init --recursive
pnpm install
```

### Start local development

- Use `README.md` and `docs/local-development.md` in this repo for the root development setup.
- The frontend and smart contract repositories each have their own setup instructions once their submodules are initialized.
- Run the root test suite with:

```bash
pnpm test
```

### Local repo basics

- `sdk/` — TypeScript SDK and client helpers
- `cli/` — command-line interface for contract interactions
- `indexer/` — event indexer service for frontend data
- `notifications/` — webhook notification service
- `docs/` — shared documentation and contribution guides

---

## Issue process

1. Search open issues in the appropriate repo.
2. If you find an existing issue, comment with your interest and proposed approach.
3. If you do not find an issue, open a new one in the most relevant repo using the decision tree above.
4. In your issue comment, include:
   - what you plan to build
   - why the change is needed
   - any relevant experience or prior work
   - an estimated timeline
5. Wait for maintainers to assign the issue and add labels.

### Issue labels

Common labels include:

- `help wanted` — good opportunity for contributors
- `good first issue` — ideal for newcomers
- `in progress` — claimed by a contributor
- `bug` — defect in functionality
- `enhancement` — new feature or improvement
- `design` — architecture or UX proposal

---

## CI/CD pipeline reference

The repository's GitHub Actions workflows are documented in [docs/ci-cd.md](./docs/ci-cd.md). That reference explains what each workflow does, what secrets it needs, how long it usually takes, and how to debug failures.

Use it before pushing changes so you can match the relevant CI checks locally.

---

## Submitting a pull request
## Pull request process

1. Fork the repository.
2. Create a branch named for the scope of the work:
   - `fix/...`, `feat/...`, `docs/...`, `chore/...`
3. Make focused changes with clear commit messages.
4. Run the relevant tests and verify the change locally.
5. Open a PR against `main`.
6. In the PR description, include:
   - what changed
   - why it changed
   - how to test it
   - related issue reference (`Closes #...`)

### PR checklist

- [ ] Branch is based on current `main`
- [ ] Tests pass locally
- [ ] New behavior includes test coverage
- [ ] Documentation is updated where needed
- [ ] Code is easy to review and scoped to one purpose
- [ ] The PR references the relevant issue or discussion

### Cross-repo contributions

If the work touches more than one repo, mention the affected repos clearly in the issue and PRs. Maintain separate PRs for each repo unless instructed otherwise by a maintainer.

---

## Code review expectations

- Keep PRs small and focused.
- Explain your changes clearly in the PR description.
- Add tests for bug fixes and new behavior.
- Update docs when public interfaces or workflows change.
- Run the repository-specific test suite before requesting review.
- Respond to review feedback in a timely manner.
- Be open to suggestions and improve the implementation iteratively.

### Review timeline

Maintainers aim to review contributions within 48 hours. Larger or cross-repo work may take longer.

---

## Decision making

Project decisions are made through issue discussion, design proposals, and maintainer review.

- Small changes: approved by maintainers after issue/PR discussion.
- Larger technical changes: require a design issue or RFC-style proposal first.
- Cross-repo coordination: handled in the root repository and tracked through issue comments.

When in doubt, ask in the issue or open a discussion to confirm the recommended approach.

### Secret scanning and false positives

This repository enforces secret scanning locally before each commit.

- A Husky `pre-commit` hook runs `gitleaks` against the repository.
- The scan is configured in `gitleaks.toml` and includes ILN-specific rules for Stellar secret seeds, Ethereum private keys, AWS credentials, and generic API tokens.
- Existing findings are recorded in `.secrets.baseline`; new commits must not introduce additional findings.

If you encounter a false positive:

1. Confirm the value is not an actual secret.
2. If the finding is valid and should remain in the baseline, regenerate the baseline with:

```bash
pnpm run gitleaks:baseline
```

3. If the finding is not relevant and should be ignored permanently, add a specific allowlist entry to `gitleaks.toml` rather than disabling scanning globally.

4. Document any baseline or allowlist updates in your PR so reviewers can verify the change.

---

## Getting help

- **GitHub Discussions** — for questions, ideas, and early proposals
- **Issues** — for bug reports, feature requests, and task planning
- **Discord** — community chat and support (invite link pending)

If you are new to Soroban development, start with the [Stellar Developer Docs](https://developers.stellar.org/docs/build/smart-contracts/overview) and the [Soroban examples repo](https://github.com/stellar/soroban-examples).

---

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) Code of Conduct. By contributing, you agree to uphold the standards in that policy.

---

## Responsible disclosure

If you discover a security vulnerability in the smart contract or any part of ILN, please **do not open a public issue**.

Email us at `margretnursca@gmail.com` or open a GitHub Security Advisory.

Please include:

- a description of the vulnerability
- steps to reproduce
- your assessment of impact
- any suggested fix

We will acknowledge your report within 48 hours.
