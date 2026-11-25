/**
 * Log redaction for payer, signatures, KYB evidence, and provider secrets (issues #1239, #1487).
 *
 * The oracle sees the most sensitive identifiers in the system:
 *  1. Payer wallet addresses and on-chain account references.
 *  2. Cryptographic signatures (Ed25519 attestations, payer authorization signatures).
 *  3. KYB evidence (corporate registration numbers, tax identifiers, beneficial ownership).
 *  4. Provider secrets (API keys, bearer tokens, connection credentials).
 *
 * None of it belongs in a log line or metrics label, where it outlives the request,
 * is shipped to external aggregators, and is visible across operator tooling.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUDIT SPECIFICATION & MATRICES (#1487)
 * ─────────────────────────────────────────────────────────────────────────────
 * - Normal: Logs and errors contain redacted prefixes (e.g. `GDVEU3DD…`, `[REDACTED_SECRET]`).
 *   Response bodies to verified callers retain full payload integrity.
 * - Failed: Unhandled exceptions, network timeouts, and client parsing rejections echoing
 *   upstream credentials or signatures are fully scrubbed through `redactErrorMessage`.
 * - Repeated: Multiple occurrences of duplicate or mixed secrets in a single log line or
 *   nested JSON object are completely replaced idempotently without partial leak.
 * - Stale: Cached or replay evidence logged during validation checks is scrubbed
 *   identically to live verification attempts.
 * - Interrupted: Streaming errors or aborted requests do not bypass error message sanitization.
 *
 * Source of Truth:
 * - Redaction regexes and normalization rules defined in this module.
 *
 * Failure Behavior:
 * - Fail-safe: When parsing unstructured or malformed input fails, default to scrubbing
 *   all matching secret patterns or falling back to a safe placeholder.
 *
 * Residual Risk & Maintainer Approval Decisions:
 * - Residual Risk: Highly unusual non-standard token formats (e.g., arbitrary length binary
 *   blobs without delimiters) could theoretically slip past regexes if echoed in raw dumps.
 *   Mitigation: Raw payload dumps are forbidden in oracle logging; structured logging is enforced.
 */

/**
 * A Stellar strkey (`G` + 55 base32 characters). Anchored on a word boundary so
 * a full address embedded in a URL, JSON blob, or provider error message is
 * still caught.
 */
const STELLAR_ADDRESS_PATTERN = /\bG[A-Z2-7]{55}\b/g;

/**
 * 64-byte Ed25519 signatures rendered in hexadecimal (128 hex chars)
 * or base64 (86-88 chars, ending in optional padding).
 */
const ED25519_HEX_SIG_PATTERN = /\b[0-9a-fA-F]{128}\b/g;
const ED25519_BASE64_SIG_PATTERN = /\b[A-Za-z0-9+/]{86,88}={0,2}\b/g;

/**
 * Common signature parameter or header assignments in URLs, logs, or headers:
 * e.g., `signature=...`, `payerSignature=...`, `sig=...`, `X-ILN-Signature: ...`.
 */
const SIGNATURE_KV_PATTERN =
  /((?:signature|payerSignature|payer_signature|sig|x-iln-signature)\s*[:=]\s*)(["']?)[A-Za-z0-9+/=_.-]{16,}\2/gi;

/**
 * Provider secrets, bearer tokens, API keys, and connection credentials:
 * e.g., `Bearer <token>`, `Basic <credentials>`, `sk_live_...`, `sec_...`, `apikey=...`,
 * or database URIs with passwords (`redis://:pass@`, `postgres://user:pass@`).
 */
const BEARER_AUTH_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const BASIC_AUTH_PATTERN = /\bBasic\s+[A-Za-z0-9+/=]+/gi;
const API_KEY_PREFIX_PATTERN = /\b(?:sk|sec|pk|key)_[a-zA-Z0-9_\-]{16,}\b/gi;
const SECRET_KV_PATTERN =
  /((?:api[_-]?key|secret|password|auth[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*)(["']?)[^\s"',;]+\2/gi;
const URI_CREDENTIAL_PATTERN = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s]+):([^@\s]+)@/g;

/**
 * Sensitive KYB identifiers:
 * Tax IDs (EIN / VAT: XX-XXXXXXX or 8-12 alphanumeric),
 * corporate registration IDs, beneficial ownership SSNs/IDs.
 */
const KYB_EVIDENCE_KV_PATTERN =
  /((?:taxId|tax_id|ein|vatNumber|vat_number|registrationNumber|registration_number|nationalId|national_id|beneficialOwner|beneficial_owner)\s*[:=]\s*)(["']?)[A-Za-z0-9\-_]{5,}\2/gi;

/** How many leading characters of an address survive in a log line. */
export const PAYER_LOG_PREFIX_LENGTH = 8;

/**
 * Reduce a payer address to a short, non-identifying prefix for correlation.
 *
 * Eight characters is enough to tell two payers apart in a log without being a
 * usable on-chain handle — the same width already used for span attributes and
 * the mock KYB provider's placeholder business names.
 */
export function truncatePayer(payer: string, visible = PAYER_LOG_PREFIX_LENGTH): string {
  const trimmed = payer.trim();
  if (trimmed.length <= visible) {
    return trimmed;
  }
  return `${trimmed.slice(0, visible)}…`;
}

/**
 * Scrub every full Stellar address out of a free-form string, keeping a short
 * prefix so the redacted text is still diagnosable. Used on provider error
 * messages, which frequently echo the URL (and therefore the payer) back.
 */
export function redactStellarAddresses(text: string): string {
  return text.replace(STELLAR_ADDRESS_PATTERN, (address) => truncatePayer(address));
}

/**
 * Scrub Ed25519 signatures and signature field assignments from logs.
 */
export function redactSignatures(text: string): string {
  return text
    .replace(SIGNATURE_KV_PATTERN, '$1[REDACTED_SIGNATURE]')
    .replace(ED25519_HEX_SIG_PATTERN, '[REDACTED_SIGNATURE]')
    .replace(ED25519_BASE64_SIG_PATTERN, (val) => {
      // Don't redact Stellar strkeys if they happen to match base64 length
      if (val.startsWith('G') && val.length === 56) return val;
      return '[REDACTED_SIGNATURE]';
    });
}

/**
 * Scrub provider secrets, authorization tokens, API keys, and connection credentials.
 */
export function redactProviderSecrets(text: string): string {
  return text
    .replace(URI_CREDENTIAL_PATTERN, '$1$2:[REDACTED_PASSWORD]@')
    .replace(BEARER_AUTH_PATTERN, 'Bearer [REDACTED_TOKEN]')
    .replace(BASIC_AUTH_PATTERN, 'Basic [REDACTED_CREDENTIALS]')
    .replace(API_KEY_PREFIX_PATTERN, '[REDACTED_API_KEY]')
    .replace(SECRET_KV_PATTERN, '$1[REDACTED_SECRET]');
}

/**
 * Scrub sensitive KYB evidence fields (tax IDs, EINs, registration numbers, beneficial owners).
 */
export function redactKybEvidence(text: string): string {
  return text.replace(KYB_EVIDENCE_KV_PATTERN, '$1[REDACTED_KYB_ID]');
}

/**
 * Comprehensive log sanitizer covering:
 *  1. Provider secrets (API keys, bearer tokens, connection credentials).
 *  2. Cryptographic signatures (Ed25519 signatures, authorization signatures).
 *  3. KYB sensitive identifiers (registration numbers, tax IDs).
 *  4. Payer addresses (truncated to non-identifying 8-char prefixes).
 */
export function redactLog(text: string): string {
  let sanitized = redactProviderSecrets(text);
  sanitized = redactSignatures(sanitized);
  sanitized = redactKybEvidence(sanitized);
  sanitized = redactStellarAddresses(sanitized);
  return sanitized;
}

/**
 * Deeply redact a JavaScript payload (object, array, or primitive) before logging.
 */
export function redactPayload<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return redactLog(data) as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactPayload(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('secret') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('password') ||
        lowerKey.includes('authorization') ||
        lowerKey.includes('token')
      ) {
        result[key] = '[REDACTED_SECRET]';
      } else if (lowerKey.includes('signature') || lowerKey === 'sig') {
        result[key] = '[REDACTED_SIGNATURE]';
      } else if (
        lowerKey === 'taxid' ||
        lowerKey === 'tax_id' ||
        lowerKey === 'ein' ||
        lowerKey === 'registrationnumber' ||
        lowerKey === 'registration_number'
      ) {
        result[key] = '[REDACTED_KYB_ID]';
      } else if (lowerKey === 'payer' && typeof value === 'string') {
        result[key] = truncatePayer(value);
      } else {
        result[key] = redactPayload(value);
      }
    }
    return result as T;
  }

  return data;
}

/**
 * Render an unknown thrown value as a redacted, single-line string.
 *
 * Never assume the message is benign: an indexer, RPC client, or Redis adapter
 * will happily paste the full request URL, bearer token, signature, or payer
 * into its error string.
 */
export function redactErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactLog(message);
}
