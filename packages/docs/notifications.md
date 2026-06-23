# Notifications System Documentation

## Why notifications: the problems they solve

The notification system ensures users and integrators are promptly informed about important events, such as invoice status changes, approvals, payments, and governance actions. This reduces manual checking, improves workflow efficiency, and enables automated responses via webhooks.

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

Each event type has a specific JSON schema. Example payloads:

### Invoice Approved
```json
{
  "event": "invoice.approved",
  "invoiceId": "inv_12345",
  "amount": "1000.00",
  "currency": "USD",
  "approvedBy": "user_abc",
  "timestamp": "2026-04-29T12:34:56Z"
}
```

### Payment Received
```json
{
  "event": "payment.received",
  "invoiceId": "inv_12345",
  "amount": "1000.00",
  "currency": "USD",
  "payer": "user_xyz",
  "timestamp": "2026-04-29T13:00:00Z"
}
```

*Add additional event types as needed.*

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
