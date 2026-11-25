import { describe, expect, it } from 'vitest';
import {
  redactErrorMessage,
  redactKybEvidence,
  redactLog,
  redactPayload,
  redactProviderSecrets,
  redactSignatures,
  redactStellarAddresses,
  truncatePayer,
  PAYER_LOG_PREFIX_LENGTH,
} from './redaction';
import { TEST_PAYER } from './testFixtures';

describe('redaction: payer data (#1487)', () => {
  it('truncates Stellar strkeys to 8-char prefixes with ellipsis', () => {
    expect(truncatePayer(TEST_PAYER)).toBe(`${TEST_PAYER.slice(0, PAYER_LOG_PREFIX_LENGTH)}…`);
    expect(truncatePayer(TEST_PAYER)).not.toContain(TEST_PAYER);
  });

  it('leaves short addresses and identifiers intact', () => {
    expect(truncatePayer('GABC')).toBe('GABC');
    expect(truncatePayer('  padded  ')).toBe('padded');
  });

  it('scrubs full Stellar addresses embedded in URLs, query parameters, and messages', () => {
    const raw = `GET /v1/history?payer=${TEST_PAYER}&source=rpc error on ${TEST_PAYER}`;
    const scrubbed = redactStellarAddresses(raw);

    expect(scrubbed).not.toContain(TEST_PAYER);
    expect(scrubbed).toContain(`${TEST_PAYER.slice(0, 8)}…`);
    expect(scrubbed).toContain('GET /v1/history?payer=');
  });
});

describe('redaction: signatures (#1487)', () => {
  const hexSignature = 'a'.repeat(128);
  const b64Signature = 'M'.repeat(86) + '==';

  it('redacts 128-char hex Ed25519 signatures', () => {
    const logLine = `Verification failed: signature=${hexSignature} for contract`;
    const scrubbed = redactSignatures(logLine);

    expect(scrubbed).not.toContain(hexSignature);
    expect(scrubbed).toContain('[REDACTED_SIGNATURE]');
  });

  it('redacts base64 Ed25519 signatures', () => {
    const logLine = `Header X-ILN-Signature: ${b64Signature} failed verification`;
    const scrubbed = redactSignatures(logLine);

    expect(scrubbed).not.toContain(b64Signature);
    expect(scrubbed).toContain('[REDACTED_SIGNATURE]');
  });

  it('redacts signature key-value pairs in URLs and JSON fragments', () => {
    const logLine = `payload error: payerSignature: "3d8f7e2a9b4c10293847561029384756" rejected`;
    const scrubbed = redactSignatures(logLine);

    expect(scrubbed).not.toContain('3d8f7e2a9b4c10293847561029384756');
    expect(scrubbed).toContain('payerSignature: [REDACTED_SIGNATURE]');
  });
});

describe('redaction: provider secrets (#1487)', () => {
  it('redacts Bearer tokens in headers and error messages', () => {
    const errorMsg = 'HTTP 401: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token.sig';
    const scrubbed = redactProviderSecrets(errorMsg);

    expect(scrubbed).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token.sig');
    expect(scrubbed).toContain('Bearer [REDACTED_TOKEN]');
  });

  it('redacts Basic authorization credentials', () => {
    const logLine = 'Upstream call with header Authorization: Basic dXNlcjpwYXNzd29yZA==';
    const scrubbed = redactProviderSecrets(logLine);

    expect(scrubbed).not.toContain('dXNlcjpwYXNzd29yZA==');
    expect(scrubbed).toContain('Basic [REDACTED_CREDENTIALS]');
  });

  it('redacts API keys with standard prefixes (sk_live_..., sec_..., key-...)', () => {
    const logLine = 'Failed to authenticate with provider using sk_live_98374928374928374928374';
    const scrubbed = redactProviderSecrets(logLine);

    expect(scrubbed).not.toContain('sk_live_98374928374928374928374');
    expect(scrubbed).toContain('[REDACTED_API_KEY]');
  });

  it('redacts passwords in database and cache connection URIs', () => {
    const redisUri = 'connect ECONNREFUSED redis://admin:SuperSecretPass123!@cache.internal:6379';
    const scrubbed = redactProviderSecrets(redisUri);

    expect(scrubbed).not.toContain('SuperSecretPass123!');
    expect(scrubbed).toContain('redis://admin:[REDACTED_PASSWORD]@cache.internal:6379');
  });

  it('redacts generic api_key and secret key-value assignments', () => {
    const logLine = 'Config error: api_key="prod_secret_token_12345" is invalid';
    const scrubbed = redactProviderSecrets(logLine);

    expect(scrubbed).not.toContain('prod_secret_token_12345');
    expect(scrubbed).toContain('api_key=[REDACTED_SECRET]');
  });
});

describe('redaction: KYB evidence (#1487)', () => {
  it('redacts tax IDs, EINs, and registration numbers', () => {
    const evidenceLog = 'KYB provider returned registrationNumber: "REG-99283-X" and taxId: "12-3456789"';
    const scrubbed = redactKybEvidence(evidenceLog);

    expect(scrubbed).not.toContain('REG-99283-X');
    expect(scrubbed).not.toContain('12-3456789');
    expect(scrubbed).toContain('registrationNumber: [REDACTED_KYB_ID]');
    expect(scrubbed).toContain('taxId: [REDACTED_KYB_ID]');
  });
});

describe('redaction: composite redactLog and redactErrorMessage (#1487)', () => {
  it('scrubs all categories in a single log line', () => {
    const compositeLog =
      `Request by payer ${TEST_PAYER} with api_key="sec_token9988776655" ` +
      `and signature="f".repeat(128) failed registrationNumber="CORP-5544" ` +
      `at redis://user:secretpass@127.0.0.1:6379`;
    const sanitized = redactLog(compositeLog);

    expect(sanitized).not.toContain(TEST_PAYER);
    expect(sanitized).not.toContain('sec_token9988776655');
    expect(sanitized).not.toContain('secretpass');
    expect(sanitized).not.toContain('CORP-5544');
    expect(sanitized).toContain(`${TEST_PAYER.slice(0, 8)}…`);
    expect(sanitized).toContain('[REDACTED_PASSWORD]');
  });

  it('sanitizes thrown Error objects containing multiple leaked secrets', () => {
    const error = new Error(
      `FetchError: connect failed to https://indexer.local/v1/history/${TEST_PAYER} ` +
      `using Authorization: Bearer sk_secret_token_0987654321`
    );
    const sanitized = redactErrorMessage(error);

    expect(sanitized).not.toContain(TEST_PAYER);
    expect(sanitized).not.toContain('sk_secret_token_0987654321');
    expect(sanitized).toContain(`${TEST_PAYER.slice(0, 8)}…`);
    expect(sanitized).toContain('Bearer [REDACTED_TOKEN]');
  });
});

describe('redaction: structured redactPayload (#1487)', () => {
  it('deeply redacts nested objects and arrays', () => {
    const payload = {
      payer: TEST_PAYER,
      credentials: {
        apiKey: 'sec_prod_9988776655443322',
        password: 'SuperAdminPassword!',
        token: 'ey...secret',
      },
      audit: [
        {
          signature: 'a'.repeat(128),
          taxId: '99-8877665',
        },
      ],
      metadata: {
        note: 'Normal diagnostic message without secrets',
      },
    };

    const redacted = redactPayload(payload);

    expect(redacted.payer).toBe(`${TEST_PAYER.slice(0, 8)}…`);
    expect(redacted.credentials.apiKey).toBe('[REDACTED_SECRET]');
    expect(redacted.credentials.password).toBe('[REDACTED_SECRET]');
    expect(redacted.credentials.token).toBe('[REDACTED_SECRET]');
    expect(redacted.audit[0].signature).toBe('[REDACTED_SIGNATURE]');
    expect(redacted.audit[0].taxId).toBe('[REDACTED_KYB_ID]');
    expect(redacted.metadata.note).toBe('Normal diagnostic message without secrets');
  });

  it('handles null, undefined, and non-object primitives safely', () => {
    expect(redactPayload(null)).toBeNull();
    expect(redactPayload(undefined)).toBeUndefined();
    expect(redactPayload(42)).toBe(42);
    expect(redactPayload(true)).toBe(true);
  });
});

describe('redaction: audit matrix scenarios (#1487)', () => {
  it('Normal: preserves diagnostic context while redacting identifiers', () => {
    const log = `Payer ${TEST_PAYER} completed verification with trust score 85`;
    const result = redactLog(log);
    expect(result).toBe(`Payer ${TEST_PAYER.slice(0, 8)}… completed verification with trust score 85`);
  });

  it('Failed: unhandled upstream crash echoes authorization header', () => {
    const err = new Error('HTTP 502 Bad Gateway: Authorization: Bearer secret_live_token_abc');
    expect(redactErrorMessage(err)).toBe('HTTP 502 Bad Gateway: Authorization: Bearer [REDACTED_TOKEN]');
  });

  it('Repeated: duplicate and consecutive secret appearances are all sanitized', () => {
    const repeated = `token sk_1234567890abcdef and sk_1234567890abcdef with Bearer tok1 and Bearer tok2`;
    const result = redactLog(repeated);
    expect(result).not.toContain('sk_1234567890abcdef');
    expect(result).not.toContain('tok1');
    expect(result).not.toContain('tok2');
  });

  it('Stale: replayed or cached verification log message is redacted identically', () => {
    const cachedLog = `Replaying verdict from cache for payer ${TEST_PAYER} with signature="sig_1234567890abcdef"`;
    const result = redactLog(cachedLog);
    expect(result).not.toContain(TEST_PAYER);
    expect(result).not.toContain('sig_1234567890abcdef');
  });

  it('Adversarial / Malformed: unusual formatting, tabs, line breaks around secrets', () => {
    const malformed = `secret\t:\t"unusual_secret_value"\npayerSignature : 'payer_sig_value_123456'`;
    const result = redactLog(malformed);
    expect(result).not.toContain('unusual_secret_value');
    expect(result).not.toContain('payer_sig_value_123456');
  });
});
