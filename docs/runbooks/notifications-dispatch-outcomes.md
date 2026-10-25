# Runbook: notification dispatch outcomes and recipient protection

Covers issues #1277 (delivery attempts and terminal outcomes), #1278 (wallet
identity vs notification address), #1279 (email validation before digest
enqueue) and #1280 (recipient data at rest).

**Owner:** notifications service on-call (`notifications/`).
**Controls live in:** `notifications/src/db.ts` (journal), `src/processor.ts`
(dispatch/flush), `src/recipient.ts` (identity + validation),
`src/recipient-crypto.ts` (tokenize/encrypt), `src/digest.ts` (digest gate).
**Regression suite:** `pnpm --filter iln-notifications vitest run src/__tests__/recipient-hardening.test.ts`

## 1. Terminal outcomes (#1277)

Every `dispatch_attempts` row ends in exactly one terminal state:

| `status` | `outcome_reason` | Meaning | Automatic retry? |
| --- | --- | --- | --- |
| `pending` | `NULL` | In flight; the next poll's flush retries it | yes |
| `delivered` | `delivered` | Provider (or a fallback channel) confirmed | — |
| `failed` | `max_attempts_exhausted` | `NOTIFICATIONS_MAX_DISPATCH_ATTEMPTS` (default 8) transient failures | no |
| `failed` | `permanent_error` | Provider error flagged `retryable: false` | no |
| `failed` | `invalid_recipient` | Destination failed recipient validation | no |
| `failed` | `unreadable` | Row could not be decrypted/parsed (e.g. key removed) | no |

`attempts`, `last_error`, `last_attempt_at`, `failed_at` and `delivered_at`
record what each row cost and when it ended. A late failure report can never
move a `delivered` row back to `pending`, and a replayed or rescheduled trigger
never re-sends a `failed` row.

### Signals

| Metric | Alert on |
| --- | --- |
| `iln_notifications_dispatch_terminal_total{outcome!="delivered"}` | any increase — a notification was abandoned |
| `iln_notifications_dispatch_queue{status="failed"}` | > 0 sustained |
| `iln_notifications_dispatch_queue{status="oldest_pending_age_seconds"}` | > 3600 — the flush is not draining |
| `iln_notifications_dispatch_queue{status="max_pending_attempts"}` | approaching the attempt cap |
| `iln_notifications_dispatch_attempts_total{result}` | `retry` rate vs `delivered` rate |

Logs: `[processor] Dispatch attempt <id> reached terminal failure (<reason>)`.
Logs carry the attempt id, never the destination.

### Triage and recovery

```bash
cd notifications
# Outcome counts; exits 3 when any row is failed (usable as a CI/cron check)
tsx src/audit-cli.ts --dispatch-summary
# Failed rows with reason and last error (no recipient data)
tsx src/audit-cli.ts --dispatch-list failed --limit 50
# After fixing the cause (provider restored, subscriber corrected):
tsx src/audit-cli.ts --requeue <attempt-id> --operator <your-id>
```

`--requeue` resets the row to `pending` with a fresh attempt budget, keeps the
previous `last_error`, and appends a `dispatch-requeued` entry to the signed
compliance audit chain (`--verify-integrity` checks it). Delivered rows cannot
be re-queued. Do not re-queue `invalid_recipient` rows until the subscription
destination is fixed — they will fail again on the next flush.

## 2. Wallet identity vs notification address (#1278)

A Stellar address identifies the user; it is never a delivery address. Digest
delivery resolves the mailbox from the user's `email` subscription for the
trigger (`resolveEmailRecipient`). There is no fallback to the wallet address:
a user on a daily/weekly digest with no valid email subscription is skipped and
counted in `iln_notifications_recipient_rejections_total{stage="digest_enqueue",reason="no_email_subscription"}`.

**Compatibility note:** before this change digest users needed no email
subscription (and received nothing deliverable). They must now register one via
`POST /subscribe` with `channel: "email"`.

## 3. Email validation before enqueue (#1279)

`validateEmailRecipient` gates every email before it is buffered for a digest
(`DigestScheduler.register` throws `InvalidRecipientError`) and before an
immediate email is journaled. It rejects control characters/CRLF (header
injection), RFC 5321 length overruns (64-octet local part, 254 total), Stellar
addresses, and malformed domains. Rejections are counted in
`iln_notifications_recipient_rejections_total{channel,stage,reason}` with
`stage` = `digest_enqueue` or `dispatch_enqueue`. Rows journaled before this
change with an invalid mailbox are closed as `failed/invalid_recipient` on the
next flush without contacting the provider.

## 4. Recipient data at rest (#1280)

| Where | Stored as |
| --- | --- |
| `dispatch_attempts.destination`, `dispatch_attempts.dedup_key` | `rtok:v1:<HMAC-SHA256>` token |
| `dispatch_attempts.subscription` | `renc:v1:<iv>.<tag>.<ciphertext>` (AES-256-GCM) |
| `sent_notifications.destination` | `rtok:v1:` token |

Keys derive (HKDF-SHA256) from `NOTIFICATIONS_RECIPIENT_KEY` — 32 bytes as 64
hex chars or base64. Production refuses to boot without it. Generate with
`openssl rand -hex 32` and store it in the secret manager alongside
`NOTIFICATIONS_AUDIT_KEY`.

Legacy plaintext rows keep working: lookups match token *and* plaintext, and
decryption passes unprefixed values through, so upgrading neither re-sends
delivered notifications nor strands pending ones. Erasure and unsubscribe match
all stored forms.

### Key rotation

1. Set `NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS` to the current key and
   `NOTIFICATIONS_RECIPIENT_KEY` to the new one; restart.
2. New rows use the new key; old ciphertext decrypts and old tokens still
   dedup through the previous key.
3. After the longest retention window (90 days for terminal journal rows,
   30 days for `sent_notifications`) and once `--dispatch-summary` shows no old
   pending rows, remove `NOTIFICATIONS_RECIPIENT_KEY_PREVIOUS`.

Removing a key early turns rows sealed with it into `failed/unreadable`
(visible in the metrics above) rather than silently dropping them.

### Out of scope

`subscriptions.destination` (needed for provider sends and API lookups) and
`delivery_audit_log` are unchanged; they are covered by the erasure and
retention controls in `docs/privacy.md`.
