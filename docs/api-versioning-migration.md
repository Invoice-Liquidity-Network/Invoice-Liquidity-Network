# API Versioning Migration Guide

## Overview

The ILN Indexer REST API now uses URL-based versioning. All endpoints are available under `/v1/`, and the previous unversioned URLs remain functional with deprecation headers until **1 January 2026**.

---

## What Changed

All REST routes are now prefixed with `/v1/`:

| Before | After |
|--------|-------|
| `GET /health` | `GET /v1/health` |
| `GET /invoices` | `GET /v1/invoices` |
| `GET /invoice/:id` | `GET /v1/invoice/:id` |
| `GET /stats` | `GET /v1/stats` |
| `GET /lps/top` | `GET /v1/lps/top` |
| `GET /lps/:address/stats` | `GET /v1/lps/:address/stats` |
| `GET /freelancers/:address/stats` | `GET /v1/freelancers/:address/stats` |
| `GET /history/:address` | `GET /v1/history/:address` |

Response bodies are identical between versioned and unversioned routes.

---

## Compatibility check scope

`pnpm test:compatibility` runs the fixture-backed tests in
`scripts/__tests__/check-compatibility.test.ts`. The check verifies that the
contract, canonical `sdk/` package, and frontend versions form an exact tuple in
`docs/cross-repo-dependencies.md`; it also verifies the docs version manifest,
its mirrors, and versioning pages. The fixture tests cover successful parsing,
malformed inputs, missing versions, empty matrices, mismatched tuples, and the
end-to-end happy/failure paths.

This is a release-metadata and documentation compatibility guard, not a complete
TypeScript ABI checker. It will not detect every source-level breaking API change
(such as removing an exported function parameter) unless that change also causes
the checked versions or documented matrix to change. SDK/CLI API changes require
package-level type tests, API review, and an intentional version/matrix update.

---

## Post-Consolidation Monorepo Package State

Following the SDK and CLI consolidation work, the monorepo package topology is resolved to a single canonical package per role:

| Workspace Path | Published Package Name | Status | Role |
|----------------|-----------------------|--------|------|
| `sdk/` | `@iln/sdk` | **Stable** | Canonical TypeScript SDK for Soroban contracts. |
| `packages/sdk/` | `@iln/sdk-next` | **Next / Experimental** | Browser-first SDK rewrite; pathing to `@iln/sdk` v2 (see [sdk-next-migration.md](sdk-next-migration.md)). |
| `cli/` | `@invoice-liquidity/cli` | **Stable** | Single canonical CLI tool for interacting with ILN contracts. |
| `packages/cli/` | `@iln/cli` | **Removed** | Retired duplicate CLI package; consolidated into `cli/`. |
| `packages/invoice-sdk/` | `@iln/invoice-sdk` | **Removed** | Retired zero-source re-export alias. |

---

## SDK & CLI Consolidation Migration Steps

### 1. CLI Consolidation (`packages/cli` → `cli/`)

If your project was using the retired private package `@iln/cli` (`packages/cli`), migrate to `@invoice-liquidity/cli` (`cli/`):

1. **Update `package.json` dependency**:
   ```diff
   - "@iln/cli": "*"
   + "@invoice-liquidity/cli": "^0.1.0"
   ```
2. **Command syntax mapping**:

   | `packages/cli` command | `cli/` equivalent |
   |---|---|
   | `iln invoice submit` | `iln submit` |
   | `iln invoice fund` | `iln fund` |
   | `iln invoice pay` | `iln pay` |
   | `iln invoice get` | `iln status` |
   | `iln invoice list` | `iln list` |
   | `iln invoice watch` | `iln watch` |
   | `iln invoice export` | `iln export` |
   | `iln stats` | `iln stats` |
   | `iln reputation get` | `iln reputation get` |
   | `iln network switch` | `iln network switch` |

### 2. SDK Package Removal (`packages/invoice-sdk`)

`packages/invoice-sdk` was an unused re-export alias and has been removed. All imports must target `@iln/sdk` directly:

```diff
- import { ILNSdk } from '@iln/invoice-sdk';
+ import { ILNSdk } from '@iln/sdk';
```

## Backward Compatibility

The old unversioned routes (`/invoices`, `/health`, etc.) continue to work but will include two additional response headers:

```
Deprecation: true
Sunset: Sat, 01 Jan 2026 00:00:00 GMT
```

After the sunset date these routes will be removed. Migrate to `/v1/` before then.

---

## Detecting the Served Version

All `/v1/` responses include:

```
API-Version: 1
```

You can inspect this header to confirm which version is serving a response.

---

## Version Negotiation

Two request-side mechanisms let callers indicate a preferred version without changing the URL:

### Accept header

```bash
curl -H "Accept: application/vnd.iln.v1+json" https://api.example.com/invoices
```

### API-Version header

```bash
curl -H "API-Version: 1" https://api.example.com/invoices
```

When either header is present, the response will include `API-Version: 1`.

---

## Migration Steps

1. Update base URL from `https://api.example.com` to `https://api.example.com/v1`:

   ```diff
   - const BASE = 'https://api.example.com';
   + const BASE = 'https://api.example.com/v1';
   ```

2. No other changes are needed — request parameters and response shapes are unchanged.

3. Verify by checking the `API-Version: 1` header in responses.

---

## curl Examples

**Before:**
```bash
curl https://api.example.com/invoices?status=Pending
curl https://api.example.com/invoice/42
curl https://api.example.com/stats
```

**After:**
```bash
curl https://api.example.com/v1/invoices?status=Pending
curl https://api.example.com/v1/invoice/42
curl https://api.example.com/v1/stats
```
