# Contributing to Invoice Liquidity Network

Thank you for your interest in contributing to Invoice Liquidity Network (ILN).

## Development setup

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- pnpm 9+
- Rust 1.74+
- Docker
- Stellar CLI

### Clone and install

```bash
git clone --recurse-submodules https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network.git
cd Invoice-Liquidity-Network
git submodule update --init --recursive
pnpm install
```

This repository uses pnpm. Run `pnpm install` from the repository root and do not create package-lock or yarn lockfiles.

## Local development

Use `README.md` and `docs/local-development.md` for repository-specific development instructions.

Run the main test suite with:

```bash
pnpm test
```

Useful checks include:

```bash
pnpm lint
pnpm type-check
pnpm format:check
pnpm build
```

## Secret scanning

The repository uses gitleaks to prevent secrets from being committed. The scan
runs in CI on every pull request and push via the `gitleaks` job in
`.github/workflows/ci.yml`. Commit-level enforcement is configured through a
Husky `pre-commit` hook after `pnpm install` (the root `prepare` script installs
Husky); a commit containing a detected secret is rejected. Remove the secret
from the staged changes, rotate or revoke it when appropriate, and then commit
again. Do not add real credentials to source files, examples, documentation,
tests, or local configuration that could be committed. Use environment
variables and document required variables instead.

In a genuine emergency only, the hook can be bypassed with:

```bash
HUSKY=0 git commit -m "your commit message"
```

Bypassing the hook is not a way to avoid remediation. It requires immediate follow-up: remove the secret from the commit and repository history as necessary, rotate or revoke the credential, run the gitleaks scan manually, and notify the maintainers if the secret may have been exposed.

You can run a scan manually with:

```bash
pnpm gitleaks:scan
```

## Pull requests

1. Create a focused branch from the current `dev` branch (the repository's default branch).
2. Keep changes limited to the issue being addressed.
3. Add or update tests for behavior changes.
4. Run the relevant formatting, lint, type-check, build, and test commands locally.
5. Open a pull request with a clear description of the change, verification performed, and any follow-up work.

Use conventional commit messages where possible, for example:

```text
security: add gitleaks pre-commit hook via Husky
```

## Code standards

- Follow the existing TypeScript, Rust, and Markdown conventions in the affected area.
- Prefer small, explicit changes over unrelated refactors.
- Never commit credentials, private keys, tokens, or other sensitive data.
- Keep generated files and dependency lockfiles consistent with the repository's package-manager policy.

## Getting help

For questions about an issue or repository ownership, open an issue in `Invoice-Liquidity-Network` and describe the affected area and the steps already taken. Maintainers will route cross-repository work as needed.
