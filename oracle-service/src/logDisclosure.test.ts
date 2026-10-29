import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { redactErrorMessage, redactStellarAddresses, truncatePayer } from './redaction';
import { createOracleApp } from './index';
import { TEST_PAYER, makeReputation } from './testFixtures';

/**
 * Payer / KYB log-disclosure guard (issue #1239).
 *
 * A payer address and the KYB evidence derived from it must never reach a log
 * line. Logs outlive the request, ship to third-party collectors and are read
 * by more people than the verdict endpoint ever is. The first and last test
 * prove the *response* still carries the evidence — only the log is scrubbed.
 */

const VALID_BODY = { payer: TEST_PAYER, amount: '10000000', invoiceId: 42 };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function captureConsole() {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const all = () =>
    [...warn.mock.calls, ...error.mock.calls, ...log.mock.calls]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');
  return { warn, error, log, all };
}

describe('redaction helpers (#1239)', () => {
  it('truncates a payer to a short, non-identifying prefix', () => {
    expect(truncatePayer(TEST_PAYER)).toBe(`${TEST_PAYER.slice(0, 8)}…`);
    expect(truncatePayer(TEST_PAYER)).not.toContain(TEST_PAYER);
  });

  it('leaves a short identifier alone', () => {
    expect(truncatePayer('SHORT')).toBe('SHORT');
    expect(truncatePayer('  padded  ')).toBe('padded');
  });

  it('scrubs full Stellar addresses embedded in free text', () => {
    const text = `WRONGTYPE on key oracle:v1:${TEST_PAYER}:10000000:42`;
    const redacted = redactStellarAddresses(text);

    expect(redacted).not.toContain(TEST_PAYER);
    expect(redacted).toContain(`${TEST_PAYER.slice(0, 8)}…`);
    expect(redacted).toContain('oracle:v1:');
  });

  it('only matches a full 56-character strkey', () => {
    const tooShort = `G${'A'.repeat(54)}`;
    const exact = `G${'A'.repeat(55)}`;

    expect(redactStellarAddresses(`x${tooShort}y`)).toBe(`x${tooShort}y`);
    expect(redactStellarAddresses(exact)).not.toContain(exact);
  });

  it('renders any thrown value as a redacted single line', () => {
    expect(redactErrorMessage(new Error(`boom ${TEST_PAYER}`))).not.toContain(TEST_PAYER);
    expect(redactErrorMessage('plain failure')).toBe('plain failure');
    expect(redactErrorMessage({ weird: true })).toBe('[object Object]');
  });
});

describe('indexer-unavailable log is redacted (#1239)', () => {
  it('keeps the operator signal but not the payer or the URL', async () => {
    const spy = captureConsole();
    globalThis.fetch = vi.fn(async () => {
      // The client error echoes the request URL — and the payer is in it.
      throw new Error(`connect ECONNREFUSED http://indexer.local/v1/history/${TEST_PAYER}`);
    }) as unknown as typeof fetch;

    const { app, close } = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      reputationProvider: async () => makeReputation(Date.now(), { score: 90 }),
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);
      expect(res.status).toBe(200);

      // The stable, greppable operator signal is preserved…
      expect(spy.warn).toHaveBeenCalledWith(expect.stringContaining('indexer unavailable'));
      // …but the payer and the URL are not.
      const logged = spy.all();
      expect(logged).not.toContain(TEST_PAYER);
      expect(logged).toContain(`${TEST_PAYER.slice(0, 8)}…`);
    } finally {
      await close();
    }
  });
});

describe('KYB evidence is never logged (#1239)', () => {
  const businessName = 'Suspicious Ghost Entity LLC';
  const registrationNumber = 'INVALID-000';
  const signal = 'Registration revoked by corporate registrar';

  async function verifyOnce() {
    const spy = captureConsole();
    const { app, close } = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => [],
      reputationProvider: async () => makeReputation(Date.now(), { score: 90 }),
      kybProvider: {
        name: 'kyb-test',
        verifyPayer: async () => ({
          provider: 'kyb-test',
          isVerified: false,
          businessName,
          registrationNumber,
          signals: [signal],
        }),
      },
    });
    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);
      return { res, logged: spy.all() };
    } finally {
      await close();
    }
  }

  it('carries the evidence in the response but not in any log line', async () => {
    const { res, logged } = await verifyOnce();

    // The caller still gets the reason for the denial…
    expect(res.body.isVerified).toBe(false);
    expect(res.body.evidence.join(' ')).toContain(businessName);
    // …while the logs stay clean.
    expect(logged).not.toContain(businessName);
    expect(logged).not.toContain(registrationNumber);
    expect(logged).not.toContain(signal);
    expect(logged).not.toContain(TEST_PAYER);
  });

  it('holds across a fresh instance (restart), not just within one process lifetime', async () => {
    const first = await verifyOnce();
    const second = await verifyOnce();

    for (const { logged } of [first, second]) {
      expect(logged).not.toContain(businessName);
      expect(logged).not.toContain(TEST_PAYER);
    }
  });
});
