# Notifications System Documentation

## Why notifications: the problems they solve

The notification system ensures users and integrators are promptly informed about important events, such as invoice status changes, approvals, payments, and governance actions. This reduces manual checking, improves workflow efficiency, and enables automated responses via webhooks.

## Delivery channels

### Implemented today

`SubscriptionChannel` and `MultiChannelDelivery` implement exactly four lowercase channel names:

| Channel | Required destination | Adapter payload |
| --- | --- | --- |
| `email` | `email` | `subject` and `message` |
| `webhook` | `webhookUrl` | `trigger`, `actor`, complete `invoice`, `subject`, `message`, `eventId`, and `eventType` |
| `sms` | `phone` | `subject` plus invoice ID and status as text |
| `websocket` | `stellarAddress` | `trigger`, `invoiceId`, `status`, `subject`, `message`, `actor`, and `eventId` |

Primary channels run concurrently. Only when every primary attempt fails does the fallback chain run sequentially until one succeeds. A missing adapter produces `no_adapter`; a missing destination produces `skipped`.

The persisted subscription and `NotificationService` path currently accepts only `email` and `webhook`. SMS and WebSocket are implemented by the injectable dispatcher but are not persisted user preferences. The React `NotificationCenter` is an in-app event-stream consumer, not another `SubscriptionChannel`. There is currently no frontend `useNotifications` hook or email-reminder preference, so that integration remains planned work and must use these exact channel names and the shared `NotificationPayload` shape.

### Planned, not implemented

- Frontend opt-in email reminder controls and a `useNotifications` integration.
- Persisted SMS and WebSocket preferences.
- Browser/mobile push; `push` is not a valid channel today.

## User Guide: Setting Up Email Alerts

To receive email alerts:
1. Navigate to your account settings in the Invoice Liquidity Network frontend.
2. Locate the "Notifications" section.
3. Enter your email address and select the events you wish to be notified about (e.g., invoice approved, payment received).
4. Save your preferences.

*Screenshot: [Add screenshot from Issue #71 here]*

## User Guide: Setting Up Webhook Alerts

To receive webhook notifications:
1. Go to your account settings and open the "Notifications" section.
2. Enter your webhook URL and select the events to subscribe to.
3. Save your preferences.

Webhook notifications will POST a JSON payload to your URL for each event.

## Webhook Payload Format

The webhook adapter sends the shared `NotificationPayload` fields. For example:

```json
{
  "trigger": "invoice_paid",
  "actor": "payer",
  "invoice": {
    "id": 12345,
    "freelancer": "G...",
    "payer": "G...",
    "amount": "10000000",
    "due_date": 1780000000,
    "discount_rate": 250,
    "status": "Paid",
    "funder": "G...",
    "funded_at": 1779000000,
    "created_at": 1778000000,
    "updated_at": 1779500000
  },
  "subject": "Invoice paid",
  "message": "Invoice #12345 has been paid.",
  "eventId": "evt_123",
  "eventType": "paid"
}
```

## Developer Guide: Self-Hosting the Notification Service

To self-host:

1. Clone the repository and navigate to the notifications service directory.
2. Set the required environment variables (see below).
3. Run with Docker:

```sh
docker run -d \
  -e RESEND_API_KEY=your_resend_key \
  -e DATABASE_URL=your_db_url \
  -p 3000:3000 \
  nursca/invoice-liquidity-notifications:latest
```

4. The service will be available on port 3000.

## SDK Notifications Module Reference

*Reference the actual method signatures from the SDK. Update this section after reviewing the SDK code.*

## Environment Variables Required

- `RESEND_API_KEY`: API key for sending emails
- `DATABASE_URL`: Database connection string
- `WEBHOOK_SECRET`: (optional) Secret for signing webhook payloads

## Rate Limits and Delivery Guarantees

- Email and webhook notifications are rate-limited to 10/minute per user.
- Delivery is retried up to 3 times on failure.
- Webhook payloads are signed if `WEBHOOK_SECRET` is set.

---

*For more details, see the SDK and service source code.*

## Architectural Note: Notifications WebSocket vs Indexer Subscription

This monorepo maintains two independent WebSocket streams optimizing for distinct responsibilities:

1. **Indexer Subscription Path (`packages/indexer`)**: Tracks raw on-chain state adjustments directly via RPC streams. It handles atomic smart-contract transformations and state mutations.
2. **Notifications Path (`packages/notifications`)**: A hardened service acting as a secure real-time notification engine for front-end actions (e.g., active triggers, system alerts, user updates). It is protected by intentional per-IP connections ceilings and client authentication guards (`NOTIFICATIONS_WS_AUTH_TOKEN`) preventing unauthorized state surface scanning.
