# ILN Notification Data & Privacy Policy

This policy describes the data the **ILN notifications service** stores on
behalf of users, how long each piece of data is retained, and how users can
exercise their right to view, export, or delete their data.

For protocol-level security and threat-model information, see
[`security-guide.md`](security-guide.md) and [`threat-model.md`](threat-model.md).

---

## 1. What data we store

The notifications service stores data in two distinct buckets:

### 1a. Notification preferences (per Stellar address)

| Field | Purpose |
|-------|---------|
| `stellarAddress` | Identifies the user (Stellar public key). |
| `enabledChannels` | Which delivery channels the user has opted-in to (`email`, `sms`, `webhook`, `websocket`). |
| `frequency` | Delivery frequency: `realtime`, `daily`, or `weekly`. |
| `quietHours` | Optional `{ startHour, endHour, timezone }` window during which notifications are held back. |
| `triggerPreferences` | Per-trigger overrides (e.g. "don't notify me of `invoice_defaulted` events"). |
| `updatedAt` | ISO 8601 timestamp of the last edit. |

These are managed by `notifications/src/preferences.ts` and are exposed via
[`notifications/src/preferences-api.ts`](../notifications/src/preferences-api.ts)
(routes `GET/PUT/PATCH/DELETE /preferences/:address`,
`POST /preferences/:address/unsubscribe`,
`POST /preferences/unsubscribe/token/:token`,
`GET /preferences/:address/export`).

### 1b. Subscriptions (rows in the `subscriptions` SQLite table)

Each row describes one outbound subscription:

| Column | Purpose |
|--------|---------|
| `stellar_address` | Owning user. |
| `channel` | `email`, `webhook`, or `sms`. |
| `destination` | Delivery target (email address, URL, or E.164 phone number — the user-provided contact data). |
| `triggers` | JSON array of invoice-event triggers the user subscribed to. |
| `webhook_secret` | Optional HMAC signing secret for webhooks. |
| `created_at` | Subscription creation timestamp. |

### 1c. Delivery audit log (rows in `sent_notifications` and `webhook_delivery_logs`)

These records exist for delivery-state correctness (de-duplication and
transient-retry bookkeeping). They are not visible to users by default but
are included in the export endpoint (§3).

Records may contain the user-supplied destination (e.g. email or phone
number). This is intentional — users are entitled to see exactly what
data the service stores about them.

---

## 2. Retention Policy

| Data class | Default retention | Basis |
|------------|-------------------|-------|
| **Active preferences** (with non-empty `enabledChannels`) | Until the user updates them, unsubscribes, or deletes the record. | User-controlled. |
| **Preferences after one-click unsubscribe** (`POST /preferences/:address/unsubscribe`) | **Soft-deleted** in-place: `enabledChannels` set to `[]`, `triggerPreferences` set to `[]`. Rows persist with `updatedAt` so that subsequent re-enable requests work. | Set so users can revert an accidental unsubscribe without a support ticket. |
| **Subscriptions** (rows in `subscriptions`) | **Deleted immediately** on `DELETE /unsubscribe` (by id) or `POST /unsubscribe` (by address + destination). The deletion takes effect on the same request — no confirmation loop. | Required by opt-out compliance: unsubscribe must take effect immediately. |
| **`sent_notifications` delivery log** | 30 days from `sent_at`, then pruned by the nightly cleanup job. | Used to suppress duplicate deliveries and debug transient failures; not a long-term audit trail. |
| **`webhook_delivery_logs`** | 90 days from `created_at`. Used for retry-attempt diagnostics. | Longer than `sent_notifications` because failed webhooks need to be investigated across several retry windows. |
| **Unsubscribe tokens** | Single-use, bound to the address that minted them. A token is invalidated as soon as it is redeemed (verified via HMAC over `address.nonce`). | Links in a delivered email are the only legitimate redemption path; replay is impossible because the nonce is consumed. |
| **Wallet / on-chain data** | None — the notifications service never accesses secret keys and never touches Stellar accounts directly. | The SDK and signers hold signing material; the notifications service is purely observer-side. |

### 2a. Right to be forgotten

If a user requests deletion of all data the notifications service holds about
them and does **not** want to retain the ability to re-enable with one click,
an operator can run the equivalent of:

```ts
// Pseudocode — actual implementation lives in the notifications service
// admin tooling (not exposed publicly to avoid abuse).
for (const subId of getSubscriptionIdsByAddress(address)) {
  deleteSubscriptionById(subId);
}
preferencesService.delete(address); // wipe in-memory record
```

After such a request the address will not match any preference or
subscription row; the only remaining artefacts will be in the
`sent_notifications` / `webhook_delivery_logs` audit tables, and those purge
according to the schedule above (30 / 90 days).

---

## 3. Data export (GDPR/CCPA-style "Right of Access")

The endpoint `GET /preferences/:address/export` returns, in a single JSON
document:

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-07-26T12:00:00.000Z",
  "address": "G…",
  "preferences": { "enabledChannels": [], "frequency": "realtime", … },
  "subscriptions": [{ "id": 7, "channel": "email", "destination": "…", … }],
  "sentLog":    [{ "invoice_id": 42, "trigger": "invoice_funded", "channel": "email", "destination": "…", "sent_at": 1722000000 }],
  "webhookLogs":[{"subscription_id": 7, "destination": "https://…", "logs": [{ "status": "success", … }] }]
}
```

The response includes a `Content-Disposition: attachment` header so a
browser download saves it as `iln-preferences-<address>.json`.

The export endpoint is rate-limited per address (same `RATE_LIMIT_PER_USER`
enforcement as the other preferences routes).

---

## 4. One-click unsubscribe

Every outbound email includes a footer link to either:

- a **tokenized** URL of the form
  `https://iln.finance/unsubscribe?token=<base64(address)>.<nonce>.<hmac>`, or
- the generic preference endpoint `POST /preferences/<address>/unsubscribe`.

See: [glossary § One-Click Unsubscribe](glossary.md#one-click-unsubscribe) for the
canonical terminology.

Both endpoints take effect immediately on the first request — there is no
double-opt-in step. The token variant signs the address with HMAC-SHA256 so
the URL cannot be forged or replayed.

After redemption:

- `enabledChannels` is cleared to `[]`, so subsequent events for this address
  are routed to no destination.
- The subscriber may re-enable delivery at any time by sending `PUT
  /preferences/<address>` with the desired channels.

For templates that do **not** carry an `unsubscribeToken`, callers should
pass an `unsubscribeUrl` option to the renderer so the footer link is still
a working, address-scoped endpoint (see `notifications/src/templates/helpers.ts`).

---

## 5. What we **do not** store

| ❌ Not stored | Why |
|---------------|-----|
| Stellar secret keys | The notifications service is observer-only. |
| IP addresses | Failures are surfaced via application logs; PII is not retained alongside delivery records. |
| Tracking pixels / open-tracking data | We respect the user's inbox. |
| Third-party analytics identifiers | None are embedded in the email templates. |

---

## 6. Contact

- Email: [security@invoiceliquidity.network](mailto:security@invoiceliquidity.network)
- For data-export / deletion requests, use the API endpoints above or email
  the security contact.

_Last reviewed: 2026-07-26 — see PR #_-linked-to-Issue-#741 for the
implementation history._
