# Contributing to Invoice Liquidity Network

Thank you for your interest in contributing. Invoice Liquidity Network (ILN) is a multi-repository project. This guide explains how the three-repo structure works, where to open issues, how PRs are reviewed, how decisions are made, and how the Drips Wave model works.

> **Before adding or changing tests, read the [Consolidated Testing Strategy](docs/testing-strategy.md).** It explains which test type belongs where, when each suite runs, and how to choose coverage for a new feature.

---

## Project structure

- [Ways to contribute](#ways-to-contribute)
- [Applying to work on an issue](#applying-to-work-on-an-issue)
- [Project board](#project-board)
- [Development setup](#development-setup)
- [Testing](#testing)
- [CI/CD pipeline reference](#cicd-pipeline-reference)
- [Submitting a pull request](#submitting-a-pull-request)
- [Branch protection](#branch-protection)
- [Package naming convention](#package-naming-convention)
- [Code standards](#code-standards)
- [Automated dependency updates](#automated-dependency-updates)
- [Getting help](#getting-help)

| Repository | Purpose | Typical contributions |
|------------|---------|-----------------------|
| `Invoice-Liquidity-Network` | Project-level repo: shared docs, SDK, CLI, indexer, notifications, repo tooling, developer guides | SDK, CLI, docs, indexer improvements, notifications, repo workflows, shared tests |
| `ILN-Frontend` | Frontend dApp: freelancer dashboard, LP analytics, governance UI, visual polish | UI, UX, styles, React components, frontend integration |
| `ILN-Smart-Contract` | Soroban / Rust smart contracts, on-chain invoice lifecycle, contract tests | Contract logic, on-chain validations, Rust tests, protocol security |

This document is the entry point for first-time contributors and for anyone who wants to work across repositories.

## Ways to contribute

You can contribute code, tests, documentation, issue triage, security review, examples, or operational improvements. Keep each change focused and use the repository that owns the behavior.

## Where to contribute

- **Bug in contract behavior or on-chain logic** → `ILN-Smart-Contract`
- **Visual issue, layout bug, or frontend flow problem** → `ILN-Frontend`
- **SDK, CLI, docs, indexer, notifications, or shared repository tooling** → `Invoice-Liquidity-Network`
- **Governance process, roadmap, coordination, or project-level policy** → `Invoice-Liquidity-Network`

If you are unsure or the work spans multiple repositories, open the issue in `Invoice-Liquidity-Network` and clearly explain the affected repositories. Maintainers will help route it.

## Applying to work on an issue

Before starting, check that the issue is not already claimed, confirm its scope and dependencies, and comment with your intended approach. Keep the resulting pull request focused on the issue.

## Project board

Issues are organized on the project board and may be assigned Drips Wave points during triage. Follow the issue's acceptance criteria and link the pull request to the issue.

## Drips Wave contribution model

The Drips Wave system is the project's prioritization and complexity model. Every issue is assigned a Wave point value during triage.

- `1 point` — small docs updates, typo fixes, minor test cleanups
- `2 points` — small bug fixes, minor frontend polish, SDK/CLI improvements
- `3 points` — medium bug fixes, new helper behavior, contract interface updates, documentation with code changes
- `4 points` — new feature in one repo, significant UX flow changes, contract and SDK coordination
- `5+ points` — large cross-repo work, major architecture changes, governance, or protocol enhancements

When you open or apply to an issue, include the Wave points if available.

## Development setup

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

The root `pnpm-lock.yaml` is the only lockfile that should exist in this repository. Use `pnpm install` and `pnpm add`; do not create package-lock or yarn lock files.

## Testing

The complete test-location and test-selection guide is [docs/testing-strategy.md](docs/testing-strategy.md). In particular, use it to decide whether a change needs unit, integration, E2E, migration, schema-snapshot, load, benchmark, or mutation coverage.

Before submitting a pull request, run the checks relevant to the changed workspace and, where practical:

```bash
pnpm test
pnpm lint
pnpm type-check
pnpm format:check
```

For project-level checks, use the scripts in `package.json`, such as `pnpm test:compatibility`, `pnpm test:audit`, and the appropriate load-test command. Run `cargo test` in `ILN-Smart-Contract` for contract changes.

## CI/CD pipeline reference

CI runs on pushes to `main` and pull requests, with changed-path filtering for workspace-specific jobs. Additional workflows cover documentation, E2E tests, migrations, mutation testing, security, releases, and deployment. Check the relevant workflow when a test is scheduled rather than PR-blocking.

## Submitting a pull request

A pull request should:

- Describe the problem and the solution.
- Link the issue.
- Include tests for changed behavior, or explain why tests are not applicable.
- Identify affected repositories and any generated files, migrations, snapshots, or configuration changes.
- Confirm formatting, lint, type-check, and relevant test commands.
- Avoid unrelated refactors and committed secrets or generated runtime artifacts.

Use the pull request template and keep the title consistent with repository conventions.

## Branch protection

Do not bypass required checks or force-push shared branches. Maintainers may request additional checks for cross-repository, security-sensitive, migration, or release changes.

## Package naming convention

Use the package name already established by the workspace. Do not introduce a second package manager or duplicate package identity for an existing workspace.

## Code standards

Prefer small, typed, deterministic changes. Follow the existing formatter, linter, test framework, and naming conventions in the affected workspace. Keep production code free of test-only shortcuts and isolate external services behind fixtures or injectable dependencies where possible.

## Automated dependency updates

Review automated dependency updates for lockfile consistency, changelog impact, compatibility, and security. Run the affected workspace tests before approving an update.

## Getting help

Ask questions in the issue or pull request with the repository, workspace, command, and error output included. For cross-repository work, explain the boundary and expected ownership so maintainers can help coordinate the change.
