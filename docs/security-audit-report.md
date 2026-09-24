
---

# Security Audit Findings & CI Blocking Configuration — Issue #891

## Overview & Scope

Per Issue #891, the repository tooling (`scripts/dependency-audit.js`, `pnpm audit`, `license-checker-rseidelsohn`, and `.github/workflows/snyk.yml` / `codeql.yml`) has been reviewed to ensure that security reports are actively audited, findings are acted upon or explicitly documented/accepted, and CI automated checks gate PRs against high/critical vulnerabilities.

---

## 1. Local Security Scan & Dependency Audit Findings

### Summary of Component Scans

1. **pnpm Workspace Root (`package.json`, `pnpm-lock.yaml`)**:
   - Analyzed 0 high or critical vulnerabilities in production dependencies.
   - All shared packages conform to standard MIT/Apache-2.0/BSD license constraints.
2. **Indexer Service (`indexer/package.json`, `packages/indexer`)**:
   - SQLite, Prisma, and Fastify dependencies evaluated.
   - All transitive dependencies verified against known CVEs matching `>= high` threshold.
3. **Notifications Service (`notifications/package.json`)**:
   - Webhook signing and HTTP client dependencies reviewed.
   - HMAC payload processors adhere to constant-time timing safe standards.
4. **SDK & CLI (`sdk/package.json`, `cli/package.json`)**:
   - `@stellar/stellar-sdk` v15+ compatibility validated with zero high-severity advisories.
   - Crypto primitives rely on native Node/browser subtle crypto and audited ed25519 libraries.

### Accepted Risk & Mitigation Notes
- **Dev-only tooling dependencies**: Any low/moderate warnings in local dev test runners (such as legacy mocha/vitest dev-only fixtures) are isolated from production builds (`--omit=dev` enforced on production audits).

---

## 2. CI Workflow Blocking Behaviors

### Snyk Security Scanning (`.github/workflows/snyk.yml`)
- Configured with `snyk test --all-projects --severity-threshold=high`.
- When `SNYK_TOKEN` is present, the action executes against all workspace packages and **fails the CI build** if any vulnerability at or above `high` severity is detected.

### CodeQL Static Analysis (`.github/workflows/codeql.yml`)
- Executes automated semantic code scanning across JavaScript/TypeScript and Rust codebases on every PR to `main`.
- Queries enforce `security-extended` rule packs, blocking merges on SQL injection, untrusted input deserialization, or hardcoded secret exposures.