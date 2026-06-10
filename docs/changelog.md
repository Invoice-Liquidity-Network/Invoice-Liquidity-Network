# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
