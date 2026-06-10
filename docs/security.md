# Security

## Package Provenance (SLSA Level 3)

All ILN npm packages (`@invoice-liquidity/sdk`, `@invoice-liquidity/cli`) are published with [SLSA Level 3](https://slsa.dev/spec/v1.0/levels#build-l3) provenance attestations. This proves each release was built by the `Release` GitHub Actions workflow from this repository — not from a developer's local machine.

### How it works

1. The `Release` workflow calls `npm publish --provenance`, which generates a signed attestation linking the package tarball to the exact commit and workflow run that produced it.
2. The attestation is stored in the [GitHub Artifact Attestations](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/attestations) ledger and referenced in the `_attestations` field on the npm package page.

### Verifying provenance

#### Via npm (quickest)

```bash
npm audit signatures @invoice-liquidity/sdk
```

Expected output:

```
audited 1 package in Xs
1 package has a verified registry signature
1 package has a verified attestation
```

#### Via GitHub CLI

```bash
gh attestation verify \
  $(npm pack @invoice-liquidity/sdk --dry-run 2>/dev/null | tail -1) \
  --repo Invoice-Liquidity-Network/Invoice-Liquidity-Network
```

Or for a tarball you've already downloaded:

```bash
# 1. Download the tarball
npm pack @invoice-liquidity/sdk

# 2. Verify the attestation against the source repo
gh attestation verify invoice-liquidity-sdk-*.tgz \
  --repo Invoice-Liquidity-Network/Invoice-Liquidity-Network
```

A successful verification prints the attestation details, including the workflow run URL and the exact commit SHA used to build the package.

#### Via the npm website

Open the package page on npmjs.com (e.g. [npmjs.com/package/@invoice-liquidity/sdk](https://www.npmjs.com/package/@invoice-liquidity/sdk)) and look for the **Provenance** section, which links directly to the GitHub Actions run and the signed SLSA attestation bundle.

### Reporting vulnerabilities

Please see [SECURITY.md](../SECURITY.md) at the repository root for how to report security vulnerabilities privately.
