# Contributing to Invoice Liquidity Network

Thank you for your interest in contributing. ILN is an open-source protocol and we welcome contributions of all kinds smart contract code, frontend, documentation, research, and testing.

---

## Table of Contents

- [Ways to contribute](#ways-to-contribute)
- [Applying to work on an issue](#applying-to-work-on-an-issue)
- [Project board](#project-board)
- [Development setup](#development-setup)
- [Release process](./docs/release-process.md)
- [Submitting a pull request](#submitting-a-pull-request)
- [Branch protection](#branch-protection)
- [Code standards](#code-standards)
- [Automated dependency updates](#automated-dependency-updates)
- [Getting help](#getting-help)

---

## Ways to contribute

To contribute. We welcome:

- **Help wanted issues** — labeled `help wanted`, high priority
- **Good first issues** — labeled `good first issue`, scoped for newcomers to the codebase
- **Bug reports** — open an issue using the bug report template
- **Documentation** — improvements to README, docs/, or inline code comments
- **Security disclosures** — see [Responsible disclosure](#responsible-disclosure) below

---

## Applying to work on an issue

We use an application process to avoid duplicate work.

### Step 1 — Find an issue

Browse [open issues](../../issues) and filter by label:

| Label              | Meaning                            |
| ------------------ | ---------------------------------- |
| `help wanted`      | High priority, no funding attached |
| `good first issue` | Well-scoped, good entry point      |
| `in progress`      | Already claimed, do not apply      |

### Step 2 — Comment your application

Leave a comment on the issue with the following:

```
**Applying to work on this issue**

- **What I plan to build:** [brief description of your approach]
- **Relevant experience:** [links to past work, GitHub repos, or context]
- **Estimated timeline:** [how many days you need]
- **Questions / blockers:** [anything you need clarified before starting]
```

### Step 3 — Wait for assignment

A maintainer will review your application within **48 hours** and either:

- Assign the issue to you and add the `in progress` label, or
- Ask follow-up questions, or
- Let you know the issue has already been assigned

Do not start building before you are assigned.

### Step 4 — Build and submit a PR

Once assigned, fork the repo, build your solution, and open a pull request referencing the issue (e.g. `Closes #12`). See [Submitting a pull request](#submitting-a-pull-request) below.

### Step 5 — Review and merge

A maintainer will review your PR. Expect one or two rounds of feedback.

---

## Project board

The ILN organisation uses a single [GitHub Projects v2 board](https://github.com/orgs/Invoice-Liquidity-Network/projects/1) that spans all three repositories (main, frontend, smart contract).

### Board views

| View                      | What it shows                                  |
| ------------------------- | ---------------------------------------------- |
| **All Open Issues**       | Every open issue across all repos — start here |
| **Smart Contract Sprint** | Active Rust/Soroban work                       |
| **Frontend Sprint**       | Active Next.js/UI work                         |
| **SDK / Main Sprint**     | SDK, CLI, indexer, and docs work               |
| **Blocked**               | Issues waiting on an external dependency       |

### Picking up an issue from the board

1. Open the [All Open Issues](https://github.com/orgs/Invoice-Liquidity-Network/projects/1/views/1) view and filter by `label:good-first-issue` or `label:help-wanted`.
2. Click the issue title to open it in its home repository.
3. Follow the [Applying to work on an issue](#applying-to-work-on-an-issue) process — comment your application and wait to be assigned.
4. Once assigned, the issue status updates to **In Progress** on the board automatically.
5. Open a PR with `Closes #N` in the description; on merge the issue moves to **Done**.

> If your issue is blocked by something external, apply the `blocked` label — it will move to the **Blocked** view automatically.

For maintainer setup instructions see [`docs/project-board.md`](./docs/project-board.md).

---

## Development setup

### Prerequisites

- [Rust](https://rustup.rs/) 1.74 or higher
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/stellar-cli)
- A funded Stellar testnet wallet (see README quickstart)
- Node.js 18+ (for frontend contributions)

### Fork and clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/invoice-liquidity-network.git
cd invoice-liquidity-network

# Add upstream remote
git remote add upstream https://github.com/MAINTAINER_USERNAME/invoice-liquidity-network.git
```

### Build the contract

```bash
cd contracts/invoice_liquidity
cargo build --target wasm32-unknown-unknown --release
```

### Run tests

```bash
cargo test
```

All tests must pass before you open a PR. If you are adding new functionality, include tests for it.

### SDK type generation

The SDK exposes TypeScript types that are generated from the Soroban contract spec JSON. The generated file lives at `sdk/src/generated/types.ts` and is committed to the repo so SDK consumers do not need to run the generator.

**When to regenerate:** any time the smart contract structs, enums, or errors change.

**How to regenerate:**

```bash
# 1. Build the contract and export its spec
cd ILN-Smart-Contract
stellar contract build
stellar contract info --wasm target/wasm32v1-none/release/*.wasm --output-format json > target/spec.json
cd ..

# 2. Run the generator
pnpm generate:types
```

Commit the updated `sdk/src/generated/types.ts` alongside your contract change. CI will regenerate and fail if the committed file does not match.

### Keeping your fork up to date

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

---

## Submitting a pull request

1. **Create a branch** named after the issue: `git checkout -b fix/issue-12-payer-verification`
2. **Make your changes** with clear, focused commits
3. **Run the test suite** and confirm everything passes
4. **Open a PR** against the `main` branch of this repo
5. **Fill in the PR template** — describe what you changed, why, and how to test it
6. **Reference the issue** in the PR description: `Closes #12`

### PR checklist

- [ ] Tests pass locally (`cargo test`)
- [ ] New functionality has test coverage
- [ ] No unnecessary dependencies added
- [ ] Code follows the style guidelines below
- [ ] Docs updated if the change affects public interfaces

---

## Branch protection

Branch protection settings for the `main` branch are documented in [docs/branch-protection.md](docs/branch-protection.md).
These settings include required PR reviews, required status checks, dismissing stale reviews on new commits, requiring linear history, and restricting force pushes.

---

## Code standards

### Rust / Soroban contracts

- Follow standard Rust formatting: run `cargo fmt` before committing
- Run `cargo clippy` and resolve warnings before opening a PR
- All public functions must have doc comments (`///`)
- Avoid `unwrap()` in contract code — use proper error handling with `ContractError`
- Keep functions small and focused; split logic into modules where appropriate

### Documentation

- Write in plain, clear English
- Use sentence case for headings
- Code examples must be tested and working
- Update the relevant section of `docs/` for any interface changes

### Commit messages

We follow the Conventional Commits specification. Use the format:

```
type(scope?): short description

Optional longer explanation of why the change was made,
not just what was changed.
```

Allowed types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `perf`, `ci`, `design`, `build`

Commit messages are validated automatically:

- Local: Husky runs `commitlint` on commit messages via the `commit-msg` hook.
- CI: Pull request titles are validated by a GitHub Action. The PR title is used as the squash commit message, so it must follow the same format.

Example: `ci: add commitlint for conventional commit enforcement`

---

## Automated dependency updates

This repository uses [Renovate](https://github.com/renovatebot/renovate) to keep npm, pnpm, Cargo, and GitHub Actions dependencies current. Configuration lives in [`renovate.json`](./renovate.json) at the repository root.

### Behavior

| Update type        | Behavior                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Patch              | Individual pull requests (ungrouped for safe auto-merge); merged automatically when CI passes after a short release-age window |
| Minor, pin, digest | Grouped into a single weekly pull request (Mondays, 09:00 UTC)                                                                 |
| Major              | Separate pull requests with migration notes; never auto-merged                                                                 |
| `@stellar/*` major | Requires dependency-dashboard approval and manual review                                                                       |
| Lock files         | Refreshed weekly (Mondays, 09:00 UTC)                                                                                          |

Renovate runs on weekdays between 09:00 and 10:00 UTC.

### Enabling Renovate on a fork

1. Install the [Mend Renovate GitHub App](https://github.com/apps/renovate) on your fork or organization.
2. Grant access to this repository.
3. Renovate opens an onboarding pull request; merge it to activate updates.

Maintainers enable Renovate on the upstream repository the same way.

### Validating configuration locally

```bash
npx --yes --package renovate renovate-config-validator renovate.json
```

Optional full dry run (requires a GitHub token with repository read access):

```bash
export RENOVATE_TOKEN="$GITHUB_TOKEN"
npx --yes --package renovate renovate --platform=github \
  --dry-run=full \
  Invoice-Liquidity-Network/Invoice-Liquidity-Network
```

Review the dry-run output for expected package managers, schedules, and grouping before merging configuration changes.

---

## Responsible disclosure

If you discover a security vulnerability in the smart contract or any part of ILN, please **do not open a public issue**.

Email us at: `margretnursca@gmail.com` (or open a [GitHub Security Advisory](../../security/advisories/new))

Please include:

- A description of the vulnerability
- Steps to reproduce
- Your assessment of impact
- Any suggested fix if you have one

We will acknowledge your report within 48 hours and work with you on a responsible disclosure timeline.

## Getting help

- **GitHub Discussions** — for questions, ideas, and general conversation: [Discussions tab](../../discussions)
- **Issues** — for bug reports and feature requests only
- **Discord** — [invite link] _(add your community link here)_

If you are new to Soroban development, the [Stellar Developer Docs](https://developers.stellar.org/docs/build/smart-contracts/overview) are the best starting point. The [Soroban examples repo](https://github.com/stellar/soroban-examples) is also very useful for understanding contract patterns.

---

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md) Code of Conduct. By participating, you agree to uphold it. Maintainers reserve the right to remove anyone who violates these standards.

For the full text, see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

---

_Questions about the contribution process? Open a [Discussion](../../discussions) and we'll help._


## Dead Code Detection

This repo runs [`knip`](https://knip.dev/) to surface unused files, exports,
dependencies, and binaries across the monorepo. The check is wired into CI
as an **advisory** workflow (`.github/workflows/knip.yml`) — it reports
findings but does not block merges, so work-in-progress branches with
temporary scaffolding are not penalised.

### Running it locally

```bash
pnpm dead-code:check
```

This runs `knip` against the configuration in `knip.json`. The report has
several sections:

| Section                | Meaning                                                                |
|------------------------|------------------------------------------------------------------------|
| Unused files           | A file is on disk but no entry point's import graph reaches it.        |
| Unused dependencies    | A dependency in `package.json` is never imported by source code.       |
| Unused devDependencies | Same, for devDependencies.                                             |
| Unlisted dependencies  | An import statement references a package not declared in `package.json`. |
| Unlisted binaries      | A CI workflow or script invokes a binary not declared.                 |
| Unused exports         | A named export is never imported anywhere in the workspace.            |
| Unused exported types  | A named type/interface export is never used as a type elsewhere.       |

### When to fix vs. when to suppress

A finding can fall into one of three buckets:

1. **Genuine dead code** — delete it.
2. **Public API** that is consumed by downstream packages outside this repo
   (e.g. SDK consumers). Add it to `knip.json` under the relevant
   workspace's `entry` array so knip treats it as a root.
3. **Config-driven tool** (commitlint, husky, etc.) that knip cannot trace.
   Add the package name to `ignoreDependencies` in `knip.json`.

Please prefer **option 1** when possible. If you suppress a finding via
`knip.json`, include a comment in your PR explaining why.

### Updating the config

`knip.json` lives at the repo root. Each workspace package has its own
section under `workspaces`. The schema is documented at
[knip.dev/reference/configuration](https://knip.dev/reference/configuration).
