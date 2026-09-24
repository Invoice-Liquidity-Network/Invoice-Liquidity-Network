import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createOracleApp } from './index';
import { sloBurnRate } from './metrics';
import type { IndexerInvoiceHistoryEntry, ReputationSnapshot } from './types';

// NOTE: the historic hardcoded test payer is rejected by the installed SDK's
// Address parser (pre-existing failure in index.test.ts), so these tests mint
// a fresh valid G-address instead.
const payer = Keypair.random().publicKey();

// Fixture timestamps are relative to now so the data is fresh under the
// default 5-minute maxOracleAgeMs (fixed 2023 timestamps would read as stale).
// Four paid invoices: enough volume for confidence >= 0.55, amounts spread
// beyond the 5%-similarity fraud window, and near-identical settlement
// durations for a high variance fit — so the fresh baseline verifies.
const nowSec = Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;
function paidEntry(id: number, amount: string, fundedAgoDays: number, settledDays: number) {
  return {
    id,
    freelancer: 'G1',
    payer,
    amount,
    due_date: 0,
    discount_rate: 300,
    status: 'Paid' as const,
    funder: 'G2',
    funded_at: nowSec - fundedAgoDays * DAY,
    created_at: (nowSec - (fundedAgoDays + 10) * DAY) * 1000,
    updated_at: (nowSec - (fundedAgoDays - settledDays) * DAY) * 1000,
  };
}
const history: IndexerInvoiceHistoryEntry[] = [
  paidEntry(1, '9000000', 40, 5),
  paidEntry(2, '9500000', 30, 6),
  paidEntry(3, '10500000', 20, 5),
  paidEntry(4, '11000000', 10, 6),
];

const reputation: ReputationSnapshot = {
  address: payer,
  score: 90,
  totalPaid: 20_000_000n,
  invoiceCount: 2,
  lastActivity: nowSec - 60,
  rank: 3,
};

function failingProviders() {
  return {
    historyProvider: async (): Promise<IndexerInvoiceHistoryEntry[]> => {
      throw new Error('indexer down');
    },
    reputationProvider: async (): Promise<ReputationSnapshot> => {
      throw new Error('reputation RPC down');
    },
  };
}

describe('degraded-mode contract (issue #1057)', () => {
  it('halts with 503 + degraded flag when every source is down and nothing is cached', async () => {
    const created = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      ...failingProviders(),
    });

    try {
      const res = await request(created.app).post('/v1/verify').send({
        payer,
        amount: '10000000',
        invoiceId: 4242,
      });

      // Halt price-dependent operations: loud 503, never a fabricated answer.
      expect(res.status).toBe(503);
      expect(res.body.degraded).toBe(true);
      expect(res.body.error).toMatch(/unavailable/i);
    } finally {
      await created.close();
    }
  });

  it('serves last-known-good with a staleness flag when sources die after a success', async () => {
    let failing = false;
    const created = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => {
        if (failing) {
          throw new Error('indexer down');
        }
        return history;
      },
      reputationProvider: async () => {
        if (failing) {
          throw new Error('reputation RPC down');
        }
        return reputation;
      },
    });

    try {
      const fresh = await request(created.app).post('/v1/verify').send({
        payer,
        amount: '10000000',
        invoiceId: 4243,
      });
      expect(fresh.status).toBe(200);
      expect(fresh.body.isVerified).toBe(true);

      // Kill every source; force revalidation past the warm cache.
      failing = true;
      const degraded = await request(created.app).post('/v1/verify').send({
        payer,
        amount: '10000000',
        invoiceId: 4243,
        forceRefresh: true,
      });

      expect(degraded.status).toBe(200);
      expect(degraded.body.stale).toBe(true);
      expect(degraded.body.degraded).toBe(true);
      // A stale answer must never verify: downstream halts price action on it.
      expect(degraded.body.isVerified).toBe(false);
      expect(degraded.body.dataAgeMs).toBeGreaterThanOrEqual(0);
      expect(
        degraded.body.evidence.some((e: string) => e.toLowerCase().includes('stale'))
      ).toBe(true);
    } finally {
      await created.close();
    }
  });

  it('reports degraded mode on the health endpoint after serving stale', async () => {
    let failing = false;
    const created = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => {
        if (failing) {
          throw new Error('indexer down');
        }
        return history;
      },
      reputationProvider: async () => {
        if (failing) {
          throw new Error('reputation RPC down');
        }
        return reputation;
      },
    });

    try {
      await request(created.app).post('/v1/verify').send({
        payer,
        amount: '10000000',
        invoiceId: 4244,
      });
      failing = true;
      await request(created.app).post('/v1/verify').send({
        payer,
        amount: '10000000',
        invoiceId: 4244,
        forceRefresh: true,
      });

      const health = await request(created.app).get('/v1/health');
      expect(health.status).toBe(200);
      expect(health.body.degradedMode).toBe(true);
      expect(health.body.degradedResponses).toBe(1);
      expect(health.body.lastSuccessfulVerificationAt).toBeDefined();
    } finally {
      await created.close();
    }
  });

  it('increments the degraded-responses Prometheus counter', async () => {
    let failing = false;
    const created = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => {
        if (failing) {
          throw new Error('indexer down');
        }
        return history;
      },
      reputationProvider: async () => {
        if (failing) {
          throw new Error('reputation RPC down');
        }
        return reputation;
      },
    });

    try {
      await request(created.app).post('/v1/verify').send({
        payer,
        amount: '10000000',
        invoiceId: 4245,
      });
      failing = true;
      await request(created.app).post('/v1/verify').send({
        payer,
        amount: '10000000',
        invoiceId: 4245,
        forceRefresh: true,
      });

      const metrics = await request(created.app).get('/metrics');
      expect(metrics.text).toMatch(/oracle_degraded_responses_total 1/);
      expect(metrics.text).toMatch(/oracle_last_known_good_age_seconds \d/);
    } finally {
      await created.close();
    }
  });
});

describe('latency SLO instrumentation (issue #1054)', () => {
  let app: Awaited<ReturnType<typeof createOracleApp>>['app'];
  let closeApp: Awaited<ReturnType<typeof createOracleApp>>['close'];

  beforeEach(async () => {
    const created = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => history,
      reputationProvider: async () => reputation,
    });
    app = created.app;
    closeApp = created.close;
  });

  afterEach(async () => {
    await closeApp?.();
  });

  it('records per-stage latency histograms on every verification', async () => {
    await request(app).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 5001,
    });

    const metrics = await request(app).get('/metrics');
    expect(metrics.text).toContain('oracle_fetch_duration_seconds');
    expect(metrics.text).toContain('oracle_aggregate_duration_seconds');
    expect(metrics.text).toContain('oracle_publish_duration_seconds');
    expect(metrics.text).toContain('oracle_fetch_slo_violations_total');
    expect(metrics.text).toContain('oracle_aggregate_slo_violations_total');
    expect(metrics.text).toContain('oracle_publish_slo_violations_total');
  });

  it('counts a fetch-stage SLO violation when sources are slow', async () => {
    const slow = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return history;
      },
      reputationProvider: async () => reputation,
    });

    try {
      const res = await request(slow.app).post('/v1/verify').send({
        payer,
        amount: '10000000',
        invoiceId: 5002,
      });
      expect(res.status).toBe(200);

      const metrics = await request(slow.app).get('/metrics');
      expect(metrics.text).toMatch(/oracle_fetch_slo_violations_total 1/);
    } finally {
      await slow.close();
    }
  });

  it('exposes SLO violation totals on the health endpoint', async () => {
    await request(app).post('/v1/verify').send({
      payer,
      amount: '10000000',
      invoiceId: 5003,
    });

    const health = await request(app).get('/v1/health');
    expect(health.status).toBe(200);
    expect(health.body.sloViolations).toMatchObject({
      fetch: 0,
      aggregate: 0,
      publish: 0,
    });
  });
});

describe('sloBurnRate', () => {
  it('returns 0 with no traffic', () => {
    expect(sloBurnRate(0, 0)).toBe(0);
  });

  it('returns the violation ratio', () => {
    expect(sloBurnRate(1, 100)).toBeCloseTo(0.01);
    expect(sloBurnRate(5, 100)).toBeCloseTo(0.05);
  });
});
