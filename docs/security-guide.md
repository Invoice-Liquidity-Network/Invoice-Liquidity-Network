# Security Guide

This guide covers the security measures built into the Invoice Liquidity Network (ILN), how to report vulnerabilities, best practices for integrators, audit information, and the incident response process.

For the protocol-level attack surface analysis, see the [Threat Model](./threat-model.md).
For package provenance verification, see [Package provenance](#package-provenance-slsa-level-3) below.

---

## Security Overview

ILN protects three classes of assets:

| Asset | Protection mechanism |
|---|---|
| On-chain funds (XLM, USDC) | Smart contract authorization; only the designated account can sign |
| Transaction integrity | Transactions are built, simulated, and submitted from the same validated object |
| Off-chain service data | Rate limiting, request timeouts, pagination caps, and input validation at API boundaries |

**Trust model:**

- Users sign transactions locally in their own wallet. The SDK never holds private keys.
- Off-chain services (indexer, notifications) observe on-chain events but are not authoritative for balances or final state — only the network is.
- Every API response, SDK input, and wallet connection is treated as potentially attacker-controlled until validated.
- SLSA Level 3 provenance attestations are published with every SDK release, proving that packages were built by the official GitHub Actions workflow and not from a developer machine.

---

## Vulnerability Reporting Process

**Do not disclose vulnerabilities publicly until a fix has been issued.**

The disclosure policy — how to report, what to include, severity classification, response
timelines, safe harbour, and recognition — is defined once, canonically, in the repository root
[`SECURITY.md`](../SECURITY.md). Report through one of the channels listed there (a private
GitHub Security Advisory or `security@invoiceliquidity.network`) rather than a public issue or
pull request.

---

## Security Best Practices

### For SDK integrators

**Transaction validation**

- Always re-simulate a transaction before presenting it to the user for signing. Never trust a simulation result cached from an earlier operation.
- Validate the source account, fee, time bounds, and memo fields before signing. The SDK rejects unexpected values, but host applications should apply their own checks.

```typescript
// Build and simulate in the same call to avoid stale state
const { transaction } = await sdk.buildWriteTransaction(...);
// Inspect before presenting to user wallet
```

**Wallet provider verification**

- Detect the Freighter wallet via its published extension ID, not via duck-typing on `window.freighter`.
- Do not trust wallet providers injected by unknown browser extensions.

**Dependency management**

- Pin your lockfile (`pnpm-lock.yaml` or equivalent) and review changes to transitive dependencies on every update.
- Verify SDK package provenance after install:

```bash
npm audit signatures @invoice-liquidity/sdk
```

Expected output:
```
1 package has a verified registry signature
1 package has a verified attestation
```

**Environment variables**

- Never commit `.env` files or private keys to version control.
- Use short-lived credentials for signing on CI/CD. Rotate secrets immediately if they are accidentally exposed.
- Separate read-only RPC endpoints from write endpoints in production.

### For node operators and self-hosters

**Rate limiting**

The indexer and notifications services enforce per-IP request quotas. Configure `RATE_LIMIT_WHITELIST` with your own monitoring IPs so health checks are not throttled.

```env
RATE_LIMIT_WHITELIST=10.0.0.5,10.0.0.6
```

**Network hardening**

- Do not expose the Soroban RPC port (8000) or the node communication port (11626) to the public internet.
- Place the indexer and notifications API behind a reverse proxy that terminates TLS.

**Database**

- Restrict filesystem permissions on `indexer.db` and `notifications.sqlite` to the service user.
- Include database files in your backup and incident recovery plan.

---

## Audit Information

### Package provenance (SLSA Level 3)

All ILN npm packages (`@invoice-liquidity/sdk`, `@invoice-liquidity/cli`) are published with [SLSA Level 3](https://slsa.dev/spec/v1.0/levels#build-l3) provenance attestations. Each attestation links the published tarball to the exact GitHub Actions workflow run and commit SHA that built it.

**Verify via npm:**

```bash
npm audit signatures @invoice-liquidity/sdk
```

**Verify via GitHub CLI:**

```bash
gh attestation verify \
  $(npm pack @invoice-liquidity/sdk --dry-run 2>/dev/null | tail -1) \
  --repo Invoice-Liquidity-Network/Invoice-Liquidity-Network
```

A successful verification prints the attestation details including the workflow run URL and commit SHA.

### Smart contract audits

The Soroban smart contract is the authoritative source for on-chain state. Before each major protocol version, the contract is reviewed for:

- Authorization logic and account validation
- State transition correctness (invoice lifecycle)
- Integer overflow and arithmetic edge cases
- Reentrancy and cross-contract call risks

Audit reports are published in the repository under `contracts/audits/` when available. The current audit status for the deployed contract version is documented in [Deployment Infrastructure](./deployment/infrastructure.md).

### Dependency scanning

CI runs `pnpm audit` and license compliance checks on every pull request. The workflow enforces an 80% test-coverage floor and includes mutation testing to validate test quality.

Additionally, Snyk is configured to run weekly and on pull requests via the `snyk.yml` workflow. The `--all-projects` flag ensures that all workspaces and sub-packages in the monorepo are fully scanned for vulnerabilities.

---

## Dependency Pinning and Transitive Dependency Control

### axios override (`package.json`)

The root `package.json` contains a pnpm override forcing `axios` to `>=1.16.0`:

```json
"pnpm": {
  "overrides": {
    "axios": ">=1.16.0"
  }
}
```

**Why it exists:** This override was added as a prophylactic measure to ensure
that any transitive dependency pulling in an older axios version (e.g. via
`some-package > axios@0.x`) is resolved to a modern `>=1.16.0` release. There is
no specific CVE attached to the override in the repository history; it was
introduced during project setup as a guard against dependency drift into
end-of-life axios 0.x releases.

**When it can be removed safely:**

1. `pnpm why axios` shows that every package depending on axios already
   declares it directly at `>=1.16.0`.
2. No dependency in the monorepo resolves to `<1.0.0` via a transitive path.
3. The override has been absent from `package.json` for at least one full
   release cycle without regressions.

**Removal procedure:**

- Delete the `"axios": ">=1.16.0"` line from `pnpm.overrides`.
- Run `pnpm install` and `pnpm audit` to confirm no lockfile changes revert to
  an older axios.
- Add a changeset entry noting the override removal.

**Follow-up:** A tracking issue should remain open to revisit this override on
every major dependency update sweep until it is confirmed unnecessary.

### Software Bill of Materials (SBOM)

Each SDK release publishes a CycloneDX SBOM as a GitHub Release asset. The SBOM
is generated automatically by `CycloneDX/gh-node-module-generatebom` during the
release workflow (`.github/workflows/sdk-release.yml`) and attached to the same
GitHub Release as the npm tarball.

**Format:** CycloneDX JSON (`sbom.json`), version `1.4`.

**How to consume it:**
1. Download `sbom.json` from the GitHub Release assets page.
2. Use any CycloneDX-compatible tool to inspect it:
   - [`cyclonedx-cli`](https://github.com/CycloneDX/cyclonedx-cli): `cyclonedx-cli view --input sbom.json`
   - [Dependency-Track](https://dependencytrack.org/): upload the JSON to monitor for newly disclosed vulnerabilities.
   - [OWASP Dependency-Check](https://owasp.org/www-project-dependency-check/): convert to XML if needed.

**Why this matters:** For a financial protocol handling real value, integrators and
auditors need an authoritative, reproducible artifact listing exactly what's shipped
in each release, without needing to reconstruct the dependency tree themselves.

---

## Incident Response

### Step 1 — Detect

Monitor service health using `scripts/monitor.sh`. Integrate it into your CI and alerting pipeline. Signs of an active incident include:

- Unexpected fund movements on-chain.
- Health check failures for the indexer or notifications service.
- Anomalous error rates in SDK operations.
- Reports from users via GitHub Security Advisories or the security email.

### Step 2 — Contain

- Pause new invoice submissions and funding operations in the frontend if funds are at risk.
- Isolate the affected service (indexer, notifications, or the contract) by cutting its network access without stopping other components.
- Capture logs and database snapshots before any remediation so evidence is preserved.

### Step 3 — Report

- Open a private GitHub Security Advisory immediately, even if the full scope is unknown.
- Notify the security team at security@invoiceliquidity.network with the initial assessment.
- Do not post details in public channels (Discord, Twitter, GitHub Issues) until a fix is deployed.

### Step 4 — Remediate

- Develop and test the fix in a private branch.
- For smart contract vulnerabilities: coordinate an emergency contract upgrade or governance proposal.
- For SDK vulnerabilities: publish a patched release with SLSA attestation and notify downstream integrators via the security advisory.
- For off-chain service vulnerabilities: deploy the patched service and rotate any compromised credentials.

### Step 5 — Disclose

After the fix is deployed and downstream integrators have had time to update:

1. Publish the GitHub Security Advisory publicly.
2. Add the reporting researcher to `HALL_OF_FAME.md`.
3. Publish a post-mortem summarizing the timeline, root cause, and mitigations taken.

---

## Related Documents

- [Incident Response Runbook](./incident-response.md) — operational runbook for SDK, indexer, oracle, and notifications service incidents
- [Threat Model](./threat-model.md) — full attack surface analysis across SDK, frontend, API, and governance
- [SECURITY.md](../SECURITY.md) — canonical root-level disclosure policy and supported versions
- [Security](./security.md) — stub that redirects to `SECURITY.md`, kept for existing links
- [CI/CD](./ci-cd.md) — how security checks are enforced in the pipeline
- [Deployment Infrastructure](./deployment/infrastructure.md) — production hardening checklist
