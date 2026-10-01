# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Smart Contract

### Added
- Added `iln watch`, `iln export`, `iln stats`, `iln reputation get`, and
  `iln network switch` to the canonical CLI (`cli/`), ported over from
  `packages/cli` with parity tests (#845).

### Changed
- Documented a concrete resolution plan for `packages/sdk` (`@iln/sdk-next`):
  it is on a path to becoming `@iln/sdk` v2 rather than a permanent second
  package. See `docs/monorepo-map.md`'s Resolution Plans section (#846).
- Corrected two inaccuracies in `docs/sdk-next-migration.md`: the
  `submitInvoice` example was missing the required `token` field, and
  `fundInvoice`'s second positional argument was documented as the funder
  address when it is actually an optional funding amount (#846).
- Reversed the premature "Deprecated" status of `docs/` in
  `docs/monorepo-map.md`. `packages/docs/content/` currently covers 16 of
  `docs/`'s 54 source files (per `docs/DOCS_SETUP.md`'s migration
  checklist) — `docs/` remains the content source of record until that
  migration is complete (#847).

### Removed
- Removed `packages/invoice-sdk` (`@iln/invoice-sdk`). It was a zero-source,
  build-time re-export alias for `@iln/sdk` kept for an older import name; a
  prior workspace audit confirmed it had no remaining consumers and it had
  been flagged for removal in its own README. Resolves the "third SDK-shaped
  package" ambiguity between `sdk/`, `packages/sdk`, and `packages/invoice-sdk`
  (#848).
- Removed `packages/cli` (`@iln/cli`), an undocumented, never-published,
  smaller-surface duplicate of the canonical CLI in `cli/`. Its unique
  commands were folded into `cli/` first — see the Added entry above (#845).

## Release: 2026-05-11

### [1.0.0] - Smart Contract

---

## Full Release History

## [1.0.0] - 2026-05-11

### Added
- Core Soroban contract for invoice factoring (`submit`, `fund`, `mark_paid`).
- Protocol fee structure for LPs and freelancers.
- Sybil-resistant framework considerations for `payer_score`.
- E2E nightly workflow integration.
- `SECURITY.md` and standard open-source documentation.

### Fixed
- Fixed double-counting escrowed funds when LP yield is paid out.
- Fixed `claim_default` to properly return contributed principal to all partial funders.
- Fixed integer overflow panic in `suggested_discount_rate` formula.
- Added partial funder refunds to `cancel_invoice`.
- Replaced incorrect `Unauthorized` error with `AlreadyInitialized`.
- Ensured minimum invoice amount (`1_000_000` stroops) to prevent dust attacks.
- Enforced a maximum `due_date` offset (365 days) to prevent zombie invoices.
- Cleaned up broken absolute paths and incorrect directory structures in the documentation.


