# `@iln/opentelemetry`

OpenTelemetry instrumentation for the Invoice Liquidity Network (ILN) SDK with strict sensitive-data redaction and attribute allowlisting.

## Overview

This package instruments `@iln/sdk` client methods with OpenTelemetry spans and Prometheus-compatible metrics. Because distributed tracing backends often have broader access controls than core application databases, this library implements a **zero-trust attribute allowlist** and **automated sensitive data scrubbing**.

---

## Data Capture Scope

### ✅ What IS Captured

Only safe, low-cardinality, operational metadata is captured in spans and metrics:

| Attribute Name | Semantic Alias | Type | Description |
|---|---|---|---|
| `method` | `iln.method` | `string` | SDK method invoked (e.g. `submitInvoice`, `fundInvoice`). |
| `invoice_id` | `iln.invoice_id` | `string` | ID of the invoice operated on (safely converted from BigInt). |
| `token` | `iln.token` | `string` | Settlement token code (e.g. `USDC`, `XLM`). |
| `network` | `iln.network` | `string` | Target Stellar network (e.g. `testnet`, `mainnet`). |
| `status` | `iln.status` | `string` | Operation outcome (`success` or `error`). |
| — | `iln.error.code` | `string` | Standardized error code (e.g. `INSUFFICIENT_BALANCE`). |

#### Metrics Emitted:
- `iln.transaction.duration` (Histogram, `ms`): Latency of on-chain submission operations.
- `iln.simulation.duration` (Histogram, `ms`): Latency of Soroban transaction simulations.
- `iln.error.count` (Counter): Error occurrences tagged by method and error code.

---

### ❌ What is NEVER Captured (Redaction Policy)

The instrumentation enforces the following sensitive data safeguards:

1. **Private Keys & Secret Seeds:**
   - Stellar secret keys (`S...` 56-character Ed25519 seeds) are stripped from error messages and attributes and replaced with `[REDACTED_SECRET_KEY]`.
2. **Bearer & Authentication Tokens:**
   - HTTP Bearer headers and auth tokens are scrubbed to `Bearer [REDACTED_AUTH_TOKEN]`.
3. **Raw Transaction XDR Envelopes:**
   - Full base64-encoded Soroban transaction XDR envelopes are scrubbed to `[REDACTED_XDR_PAYLOAD]`.
4. **Arbitrary Parameters & Signer Objects:**
   - Method argument properties not in the explicit attribute allowlist (e.g. `secretKey`, `signer`, `authHeader`, `memo`, `evidenceDescription`) are ignored and never attached to spans.
5. **Error Message Length Capping:**
   - Error messages attached to span status are capped at 256 characters by default to prevent memory/collector exhaustion.

---

## Installation

```bash
pnpm add @iln/opentelemetry @opentelemetry/api
```

---

## Usage

```typescript
import { ILNSdk } from '@iln/sdk';
import { ILNInstrumentation } from '@iln/opentelemetry';

// 1. Initialize the instrumentation
const instrumentation = new ILNInstrumentation({
  redactSensitiveData: true,       // Enabled by default
  maxErrorMessageLength: 256,     // Default max length for error messages
});

// 2. Wrap your SDK client
const sdk = new ILNSdk({ ...config });
const instrumentedClient = instrumentation.instrumentClient(sdk);

// 3. Use client as normal — spans and metrics are emitted automatically
await instrumentedClient.submitInvoice({
  invoiceId: 101n,
  token: 'USDC',
  network: 'testnet',
});
```

---

## Configuration Options

```typescript
export interface ILNInstrumentationOptions {
  /**
   * Whether to sanitize and redact sensitive patterns (secret keys, tokens, XDR).
   * Default: true
   */
  redactSensitiveData?: boolean;

  /**
   * Maximum length for error messages attached to span status.
   * Default: 256
   */
  maxErrorMessageLength?: number;

  /**
   * Explicit allowlist of permitted span attribute keys.
   * Default: DEFAULT_ALLOWED_SPAN_ATTRIBUTES
   */
  allowedAttributes?: string[];

  /**
   * Custom attribute sanitizer hook for specialized scrubbing.
   */
  customRedactor?: (key: string, value: unknown) => unknown;
}
```

---

## Running Tests

```bash
pnpm --filter @iln/opentelemetry test
```
