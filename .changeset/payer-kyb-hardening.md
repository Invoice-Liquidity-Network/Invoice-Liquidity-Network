---
"@iln/oracle-service": minor
---

Payer/KYB hardening (oracle-service #1238/#1239/#1240):

- KYB verification supports an optional failover provider (`kybFallbackProvider`). The fallback is consulted only when the primary verification throws, so an explicit `isVerified: false` verdict is never bypassed and KYB enforcement stays intact.
- Payer addresses and upstream/KYB error messages are redacted before they reach logs (`truncatePayer`, `redactStellarAddresses`, `redactErrorMessage`), so payer identifiers and URL-bearing diagnostics no longer leak into log output.
- The health endpoint now reports per-source health (`sources`) and KYB enforcement state (`kyb.required`/`kyb.configured`/`kyb.failover`), and a new operator runbook (`docs/runbooks/payer-kyb-incidents.md`) documents payer/KYB incident response.
