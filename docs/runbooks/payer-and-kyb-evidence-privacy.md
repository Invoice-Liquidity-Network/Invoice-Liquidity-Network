# Payer & KYB Evidence Privacy and Log Redaction Runbook (#1239)

This operational specification governs privacy protection and data minimization for payer addresses and KYB evidence.

## Privacy Invariants

1. **Payer Address Masking**: Full 56-character Stellar public keys must NEVER be logged in plaintext. They must be masked as `GDVEU3DD...ZA57` or `GDVEU3DD`.
2. **KYB Evidence Sanitization**: Registration numbers, tax identifiers, and sensitive corporate registry details are sanitized via `sanitizeKybEvidenceString()` before inclusion in evidence strings.

## Verification

```bash
pnpm test:payer-kyb-privacy
```
