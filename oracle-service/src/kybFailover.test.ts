import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createKybProvider, createOracleApp } from './index';
import { SourceHealthTracker, defaultSourceFailoverConfig } from './sourceFailover';
import type { KYBVerificationResult, VerificationProvider } from './types';
import { TEST_PAYER, healthyHistory, makeReputation } from './testFixtures';

/**
 * KYB source failover (issue #1238).
 *
 * The primary/secondary KYB pair gets the same automated failover as the
 * indexer and the reputation RPC — but with a stronger safety property: a
 * failover may only ever *rescue* an unavailable registry, never *override* a
 * registry that answered. A fulfilled `isVerified: false` is a verdict, not an
 * outage, so the fallback must never be consulted for it.
 */

const FAST = { ...defaultSourceFailoverConfig(), cooldownMs: 1_000, recoverySuccesses: 2 };
const VALID_BODY = { payer: TEST_PAYER, amount: '10000000', invoiceId: 42 };

function provider(
  name: string,
  impl: (payer: string) => Promise<KYBVerificationResult>
): VerificationProvider {
  return { name, verifyPayer: impl };
}

function verified(name: string): KYBVerificationResult {
  return { provider: name, isVerified: true, businessName: `${name} Ltd.` };
}

async function build(overrides: Parameters<typeof createOracleApp>[0] = {}) {
  return createOracleApp({
    indexerBaseUrl: 'http://indexer.local',
    historyProvider: async () => healthyHistory(Date.now()),
    reputationProvider: async () => makeReputation(Date.now(), { score: 90 }),
    sourceFailover: FAST,
    ...overrides,
  });
}

describe('createKybProvider (#1238)', () => {
  it('passes a solo provider through untouched — no failover bookkeeping', async () => {
    const primary = provider('solo', async () => verified('solo'));
    const tracker = new SourceHealthTracker({ config: FAST });

    expect(createKybProvider(primary, undefined, tracker)).toBe(primary);
    expect(tracker.snapshot()).toEqual({});
  });

  it('fails over to the secondary when the primary throws', async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const primary = provider('primary', async () => {
      primaryCalls += 1;
      throw new Error('registry unreachable');
    });
    const fallback = provider('fallback', async () => {
      fallbackCalls += 1;
      return verified('fallback');
    });
    const tracker = new SourceHealthTracker({ config: FAST });

    const result = await createKybProvider(primary, fallback, tracker).verifyPayer(TEST_PAYER);

    expect(result.provider).toBe('fallback');
    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
    expect(tracker.snapshot()).toMatchObject({
      'kyb-primary': 'unavailable',
      'kyb-fallback': 'healthy',
    });
  });

  it('does NOT fail over when the primary answers with an unverified result', async () => {
    let fallbackCalls = 0;
    const primary = provider('primary', async () => ({
      provider: 'primary',
      isVerified: false,
      signals: ['Registration revoked'],
    }));
    const fallback = provider('fallback', async () => {
      fallbackCalls += 1;
      return verified('fallback');
    });
    const tracker = new SourceHealthTracker({ config: FAST });

    const result = await createKybProvider(primary, fallback, tracker).verifyPayer(TEST_PAYER);

    expect(result.isVerified).toBe(false);
    // The whole point: a rejection is never laundered into an approval.
    expect(fallbackCalls).toBe(0);
    expect(tracker.snapshot()['kyb-primary']).toBe('healthy');
  });

  it('rethrows when both sources are down', async () => {
    const primary = provider('primary', async () => {
      throw new Error('primary down');
    });
    const fallback = provider('fallback', async () => {
      throw new Error('fallback down');
    });
    const tracker = new SourceHealthTracker({ config: FAST });

    await expect(
      createKybProvider(primary, fallback, tracker).verifyPayer(TEST_PAYER)
    ).rejects.toThrow('fallback down');
  });
});

describe('KYB failover through the app wiring (#1238)', () => {
  it('serves a verdict from the fallback registry when the primary is down', async () => {
    let fallbackCalls = 0;
    const { app, close, health } = await build({
      kybProvider: provider('primary-kyb', async () => {
        throw new Error('registry unreachable');
      }),
      kybFallbackProvider: provider('fallback-kyb', async () => {
        fallbackCalls += 1;
        return verified('fallback-kyb');
      }),
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.isVerified).toBe(true);
      expect(res.body.kybResult.provider).toBe('fallback-kyb');
      expect(fallbackCalls).toBe(1);

      // Operator-visible proof of the failover, without reading logs.
      expect(health().kyb).toEqual({ required: false, configured: true, failover: true });
      expect(health().sources).toMatchObject({
        'kyb-primary': 'unavailable',
        'kyb-fallback': 'healthy',
      });
      expect(health().status).toBe('degraded');

      const metrics = await request(app).get('/metrics');
      expect(metrics.text).toContain('oracle_failover_events_total{source="kyb-primary"} 1');
      expect(metrics.text).toContain('oracle_source_health_state{source="kyb-primary"} 2');
    } finally {
      await close();
    }
  });

  it('never bypasses an explicit KYB rejection, even with a fallback configured', async () => {
    let fallbackCalls = 0;
    const { app, close, health } = await build({
      kybProvider: provider('primary-kyb', async () => ({
        provider: 'primary-kyb',
        isVerified: false,
        signals: ['Registration revoked by corporate registrar'],
      })),
      kybFallbackProvider: provider('fallback-kyb', async () => {
        fallbackCalls += 1;
        return verified('fallback-kyb');
      }),
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);

      expect(res.body.isVerified).toBe(false);
      expect(res.body.composition.outcome).toBe('rejected-kyb-unverified');
      expect(res.body.authorization.primary).toBe('PAYER_KYB_UNVERIFIED');
      // The fallback was never asked, and never registered.
      expect(fallbackCalls).toBe(0);
      expect(health().sources?.['kyb-fallback']).toBeUndefined();
      expect(health().sources?.['kyb-primary']).toBe('healthy');
    } finally {
      await close();
    }
  });

  it('fails closed when required KYB is unavailable and there is no fallback', async () => {
    const { app, close, health } = await build({
      requireKyb: true,
      kybProvider: provider('primary-kyb', async () => {
        throw new Error('registry unreachable');
      }),
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);

      expect(res.body.isVerified).toBe(false);
      expect(res.body.composition.outcome).toBe('rejected-kyb-unavailable');
      expect(res.body.authorization.primary).toBe('PAYER_KYB_UNAVAILABLE');
      expect(health().kyb).toEqual({ required: true, configured: true, failover: false });
    } finally {
      await close();
    }
  });

  it('fails closed when required KYB and its fallback are both down', async () => {
    const { app, close } = await build({
      requireKyb: true,
      kybProvider: provider('primary-kyb', async () => {
        throw new Error('registry unreachable');
      }),
      kybFallbackProvider: provider('fallback-kyb', async () => {
        throw new Error('fallback unreachable');
      }),
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);

      expect(res.body.isVerified).toBe(false);
      expect(res.body.composition.outcome).toBe('rejected-kyb-unavailable');
      expect(res.body.authorization.primary).toBe('PAYER_KYB_UNAVAILABLE');
    } finally {
      await close();
    }
  });

  it('keeps a configured-but-solo KYB provider working with no failover bookkeeping', async () => {
    const { app, close, health } = await build({
      kybProvider: provider('solo-kyb', async () => verified('solo-kyb')),
    });

    try {
      const res = await request(app).post('/v1/verify').send(VALID_BODY);

      expect(res.body.isVerified).toBe(true);
      expect(res.body.kybResult.provider).toBe('solo-kyb');
      expect(health().kyb).toEqual({ required: false, configured: true, failover: false });
      expect(health().sources).toEqual({});
    } finally {
      await close();
    }
  });
});
