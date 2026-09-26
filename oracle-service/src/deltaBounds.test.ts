import { describe, expect, it } from 'vitest';
import request from 'supertest';

import {
  DeltaBoundsGuard,
  SIGNAL_FEEDS,
  defaultDeltaBoundsConfig,
  loadDeltaBoundsConfig,
} from './deltaBounds';
import { createOracleApp } from './index';
import { OracleVerifier } from './verifier';
import { TEST_PAYER, healthyHistory, makeReputation } from './testFixtures';
import type { IndexerInvoiceHistoryEntry, ReputationSnapshot } from './types';

/**
 * Delta-bound guard (issue #1052).
 *
 * The property under test throughout: an update that moves a feed further in
 * one step than realistic history allows is never published on one source's
 * word, and is never silently dropped either — it lands in a review queue.
 */

const NOW = Date.now();

const composite = { feed: 'composite-trust' as const, subject: TEST_PAYER };

function confirmations(...entries: [string, number, boolean][]) {
  return entries.map(([source, value, ok]) => ({ source, value, ok }));
}

describe('delta bounds config', () => {
  it('defaults the composite feed to a quarter-move / 25-point bound with quorum 2', () => {
    const config = defaultDeltaBoundsConfig();
    expect(config.bounds['composite-trust']).toEqual({
      maxRelativeDelta: 0.25,
      maxAbsoluteDelta: 25,
      quorumSize: 2,
    });
    expect(config.maxHeldUpdates).toBe(100);
  });

  it('defines a bound for every signal feed', () => {
    const config = defaultDeltaBoundsConfig();
    for (const feed of SIGNAL_FEEDS) {
      expect(config.bounds[feed].quorumSize).toBeGreaterThanOrEqual(2);
    }
  });

  it('loads per-feed overrides from the environment', () => {
    const config = loadDeltaBoundsConfig({
      ORACLE_DELTA_BOUND_COMPOSITE_TRUST_RELATIVE: '0.1',
      ORACLE_DELTA_BOUND_COMPOSITE_TRUST_ABSOLUTE: '8',
      ORACLE_DELTA_BOUND_COMPOSITE_TRUST_QUORUM: '3',
      ORACLE_DELTA_BOUND_KYB_QUORUM: '4',
      ORACLE_DELTA_MAX_HELD_UPDATES: '7',
      ORACLE_DELTA_QUORUM_TOLERANCE: '0.4',
    });

    expect(config.bounds['composite-trust']).toEqual({
      maxRelativeDelta: 0.1,
      maxAbsoluteDelta: 8,
      quorumSize: 3,
    });
    expect(config.bounds.kyb.quorumSize).toBe(4);
    // Untouched feeds keep their defaults.
    expect(config.bounds.history).toEqual(defaultDeltaBoundsConfig().bounds.history);
    expect(config.maxHeldUpdates).toBe(7);
    expect(config.quorumAgreementTolerance).toBe(0.4);
  });

  it('ignores blank, garbage and negative env values', () => {
    const config = loadDeltaBoundsConfig({
      ORACLE_DELTA_BOUND_REPUTATION_RELATIVE: '  ',
      ORACLE_DELTA_BOUND_REPUTATION_ABSOLUTE: 'not-a-number',
      ORACLE_DELTA_BOUND_REPUTATION_QUORUM: '-2',
    });

    const defaults = defaultDeltaBoundsConfig().bounds.reputation;
    expect(config.bounds.reputation).toEqual(defaults);
  });
});

describe('DeltaBoundsGuard', () => {
  it('publishes the first observation of a key — there is nothing to bound yet', () => {
    const guard = new DeltaBoundsGuard();
    expect(guard.assess(composite, 50, [], NOW)).toEqual({ decision: 'publish' });
    expect(guard.lastPublishedValue(composite)).toBe(50);
  });

  it('publishes movement within the bound', () => {
    const guard = new DeltaBoundsGuard();
    guard.assess(composite, 50, [], NOW);

    expect(guard.assess(composite, 70, [], NOW)).toEqual({ decision: 'publish' });
    expect(guard.lastPublishedValue(composite)).toBe(70);
  });

  it('treats movement exactly at the bound as within the bound', () => {
    const guard = new DeltaBoundsGuard();
    guard.assess(composite, 50, [], NOW);

    // Absolute floor 25 dominates at this level, so 50 → 75 is allowed.
    expect(guard.assess(composite, 75, [], NOW)).toEqual({ decision: 'publish' });
  });

  it('scales the bound with the last value, never below the absolute floor', () => {
    const guard = new DeltaBoundsGuard();
    // At 200 the 25% relative term dominates the 25-point floor: 200 → 250 fits.
    guard.assess({ feed: 'history', subject: 'big' }, 200, [], NOW);
    expect(
      guard.assess({ feed: 'history', subject: 'big' }, 250, confirmations(['a', 250, true]), NOW)
    ).toEqual({ decision: 'publish' });
  });

  it('publishes an over-bound move only when the quorum of sources agrees on it', () => {
    const guard = new DeltaBoundsGuard();
    guard.assess(composite, 20, [], NOW);

    const decision = guard.assess(
      composite,
      90,
      confirmations(['history', 95, true], ['reputation', 88, true], ['external', 50, true]),
      NOW
    );

    // 'external' read 50 — far from the proposal — so it does not confirm.
    expect(decision).toEqual({
      decision: 'publish-quorum',
      delta: 70,
      bound: 25,
      confirmingSources: ['history', 'reputation'],
    });
    expect(guard.lastPublishedValue(composite)).toBe(90);
    expect(guard.getStats().totalQuorumPublished).toBe(1);
    expect(guard.getHeldUpdates()).toEqual([]);
  });

  it('failed sources never confirm, whatever they reported', () => {
    const guard = new DeltaBoundsGuard();
    guard.assess(composite, 20, [], NOW);

    const decision = guard.assess(
      composite,
      90,
      confirmations(['history', 92, false], ['reputation', 89, false]),
      NOW
    );
    expect(decision.decision).toBe('hold');
  });

  it('holds an extreme single-source spike: alerts, freezes, never drops', () => {
    const guard = new DeltaBoundsGuard();
    guard.assess(composite, 20, [], NOW);

    const decision = guard.assess(composite, 90, confirmations(['reputation', 90, true]), NOW);

    expect(decision.decision).toBe('hold');
    if (decision.decision !== 'hold') return;
    expect(decision.delta).toBe(70);
    expect(decision.bound).toBe(25);
    // One willing source is below quorum 2 — this is the attack shape.
    expect(decision.confirmingSources).toEqual(['reputation']);

    // Frozen: the published value stays at the last known good.
    expect(guard.lastPublishedValue(composite)).toBe(20);
    // Held for review, never silently dropped.
    const held = guard.getHeldUpdates();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      id: decision.heldId,
      feed: 'composite-trust',
      subject: TEST_PAYER,
      lastPublishedValue: 20,
      proposedValue: 90,
    });
  });

  it('adopts an over-bound worsening move immediately — freezing it would mask deterioration', () => {
    const guard = new DeltaBoundsGuard();
    guard.assess(composite, 90, [], NOW);

    const decision = guard.assess(composite, 20, [], NOW);
    expect(decision.decision).toBe('hold');
    // The worse value is published at once...
    expect(guard.lastPublishedValue(composite)).toBe(20);
    // ...while the anomalous drop is still queued for review.
    expect(guard.getHeldUpdates()).toHaveLength(1);
  });

  it('caps the review queue and counts what it had to evict', () => {
    const config = defaultDeltaBoundsConfig();
    config.maxHeldUpdates = 2;
    const guard = new DeltaBoundsGuard(config);

    guard.assess(composite, 10, [], NOW);
    guard.assess(composite, 100, [], NOW); // hold-1, frozen at 10
    guard.assess(composite, -20, [], NOW); // hold-2, worsening → adopt
    guard.assess(composite, 100, [], NOW); // hold-3, frozen at -20
    guard.assess(composite, 80, [], NOW); // hold-4 evicts hold-1

    const held = guard.getHeldUpdates();
    expect(held).toHaveLength(2);
    // Oldest two were evicted; the queue kept the most recent reviews.
    expect(held.map((u) => u.id)).toEqual(['hold-3', 'hold-4']);
    const stats = guard.getStats();
    expect(stats).toMatchObject({ activeHolds: 2, totalHeld: 4, totalEvicted: 2 });
  });

  it('returns copies from getHeldUpdates so consumers cannot mutate the queue', () => {
    const guard = new DeltaBoundsGuard();
    guard.assess(composite, 10, [], NOW);
    guard.assess(composite, 100, [], NOW);

    guard.getHeldUpdates()[0].proposedValue = 0;
    expect(guard.getHeldUpdates()[0].proposedValue).toBe(100);
  });

  describe('resolveHeldUpdate', () => {
    function heldSpike() {
      const guard = new DeltaBoundsGuard();
      guard.assess(composite, 20, [], NOW);
      const decision = guard.assess(composite, 90, [], NOW);
      return { guard, id: (decision as { heldId: string }).heldId };
    }

    it('accepting publishes the held value', () => {
      const { guard, id } = heldSpike();
      const resolved = guard.resolveHeldUpdate(id, 'accepted');

      expect(resolved).toMatchObject({ id, proposedValue: 90 });
      expect(guard.lastPublishedValue(composite)).toBe(90);
      expect(guard.getHeldUpdates()).toEqual([]);
      expect(guard.getStats().accepted).toBe(1);
    });

    it('rejecting reverts to the pre-hold value', () => {
      const { guard, id } = heldSpike();
      guard.resolveHeldUpdate(id, 'rejected');

      expect(guard.lastPublishedValue(composite)).toBe(20);
      expect(guard.getStats().rejected).toBe(1);
    });

    it('returns undefined for an unknown id', () => {
      const { guard } = heldSpike();
      expect(guard.resolveHeldUpdate('hold-does-not-exist', 'accepted')).toBeUndefined();
    });
  });
});

describe('delta bounds in the verifier', () => {
  const request = { payer: TEST_PAYER, amount: '10000000', invoiceId: '42' };

  function makeVerifier(sources: {
    history: () => IndexerInvoiceHistoryEntry[];
    reputation: () => ReputationSnapshot;
  }) {
    return new OracleVerifier({
      now: () => NOW,
      maxOracleAgeMs: 0,
      historyProvider: async () => sources.history(),
      reputationProvider: async () => sources.reputation(),
    });
  }

  it('publishes the first verdict untouched by the guard', async () => {
    const verifier = makeVerifier({
      history: () => [],
      reputation: () => makeReputation(NOW, { score: 20 }),
    });

    const response = await verifier.verify(request);

    expect(response.deltaGuard).toMatchObject({ decision: 'publish', feed: 'composite-trust' });
    expect(verifier.getHeldDeltaUpdates()).toEqual([]);
  });

  it('holds an extreme single-source spike and serves the frozen verdict', async () => {
    // The attack: reputation alone jumps the payer from junk to respectable
    // with no corroborating behaviour (empty history proves it).
    let reputation = 20;
    const verifier = makeVerifier({
      history: () => [],
      reputation: () => makeReputation(NOW, { score: reputation }),
    });

    const first = await verifier.verify(request);
    reputation = 100;
    const second = await verifier.verify({ ...request, invoiceId: '43', forceRefresh: true });

    expect(second.deltaGuard?.decision).toBe('hold');
    // Frozen at the last known-good score rather than crediting the spike.
    expect(second.trustScore).toBe(first.trustScore);
    expect(second.isVerified).toBe(false);
    expect(second.evidence.join(' ')).toMatch(/Held .* for review/);

    const held = verifier.getHeldDeltaUpdates();
    expect(held).toHaveLength(1);
    expect(held[0].subject).toBe(TEST_PAYER);
    expect(second.deltaGuard?.heldId).toBe(held[0].id);
  });

  it('releases a held spike once a human accepts it as genuine', async () => {
    let reputation = 20;
    const verifier = makeVerifier({
      history: () => [],
      reputation: () => makeReputation(NOW, { score: reputation }),
    });

    await verifier.verify(request);
    reputation = 100;
    const held = await verifier.verify({ ...request, forceRefresh: true });
    expect(held.deltaGuard?.decision).toBe('hold');

    const [entry] = verifier.getHeldDeltaUpdates();
    const resolved = verifier.deltaGuard.resolveHeldUpdate(entry.id, 'accepted');
    expect(resolved?.proposedValue).toBe(entry.proposedValue);
    expect(verifier.deltaGuard.lastPublishedValue(composite)).toBe(entry.proposedValue);

    // Now that the value is the accepted known good, the same verdict is an
    // ordinary in-bound publish.
    const after = await verifier.verify({ ...request, invoiceId: '44', forceRefresh: true });
    expect(after.deltaGuard?.decision).toBe('publish');
    expect(verifier.getHeldDeltaUpdates()).toEqual([]);
  });

  it('publishes an over-bound jump that two independent sources corroborate', async () => {
    let healthy = false;
    const verifier = makeVerifier({
      history: () => (healthy ? healthyHistory(NOW) : []),
      reputation: () => makeReputation(NOW, { score: healthy ? 90 : 20 }),
    });

    await verifier.verify(request);
    healthy = true;
    const jumped = await verifier.verify({ ...request, forceRefresh: true });

    // History behaviour *and* reputation moved together, so the jump is real.
    expect(jumped.deltaGuard).toMatchObject({
      decision: 'publish-quorum',
      confirmingSources: expect.arrayContaining(['history', 'reputation']),
    });
    expect(jumped.deltaGuard!.delta).toBeGreaterThan(jumped.deltaGuard!.bound);
    expect(verifier.getHeldDeltaUpdates()).toEqual([]);
  });

  it('never freezes out a sudden deterioration — the worse verdict is served, hold recorded', async () => {
    // The fail-safe direction: a clean payer who instantly reads as fraudulent
    // must be believed immediately; the anomalous move is still queued so ops
    // can investigate whether the feed is lying in the other direction.
    let fraud = false;
    const verifier = makeVerifier({
      history: () => (fraud ? [] : healthyHistory(NOW)),
      reputation: () => makeReputation(NOW, { score: fraud ? 5 : 95 }),
    });

    const first = await verifier.verify(request);
    fraud = true;
    const after = await verifier.verify({ ...request, forceRefresh: true });

    expect(first.trustScore - after.trustScore).toBeGreaterThan(after.deltaGuard!.bound);
    expect(after.deltaGuard?.decision).toBe('hold');
    expect(after.isVerified).toBe(false);
    expect(verifier.getHeldDeltaUpdates()).toHaveLength(1);
  });
});

describe('delta holds over HTTP', () => {
  it('exposes held updates for review and alerts through metrics', async () => {
    let reputation = 20;
    const { app, close } = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => [],
      reputationProvider: async () => makeReputation(NOW, { score: reputation }),
    });

    try {
      await request(app)
        .post('/v1/verify')
        .send({ payer: TEST_PAYER, amount: '10000000', invoiceId: 42 });

      // Extreme single-source spike through the full request path.
      reputation = 100;
      const spike = await request(app)
        .post('/v1/verify')
        .send({ payer: TEST_PAYER, amount: '10000000', invoiceId: 42, forceRefresh: true });
      expect(spike.body.deltaGuard.decision).toBe('hold');

      const holds = await request(app).get('/v1/oracle/delta-holds');
      expect(holds.status).toBe(200);
      expect(holds.body.heldUpdates).toHaveLength(1);
      expect(holds.body.heldUpdates[0]).toMatchObject({
        feed: 'composite-trust',
        subject: TEST_PAYER,
        lastPublishedValue: spike.body.trustScore,
      });
      expect(holds.body.stats).toMatchObject({ activeHolds: 1, totalHeld: 1, totalEvicted: 0 });

      // A bound violation must ALERT, not just sit in a queue.
      const metrics = await request(app).get('/metrics');
      expect(metrics.text).toContain(
        'oracle_delta_bound_violations_total{feed="composite-trust"} 1'
      );
      expect(metrics.text).toContain('oracle_delta_holds_active 1');
    } finally {
      await close();
    }
  });

  it('counts quorum confirmations and reports an empty queue', async () => {
    let healthy = false;
    const { app, close } = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => (healthy ? healthyHistory(NOW) : []),
      reputationProvider: async () => makeReputation(NOW, { score: healthy ? 90 : 20 }),
    });

    try {
      await request(app)
        .post('/v1/verify')
        .send({ payer: TEST_PAYER, amount: '10000000', invoiceId: 42 });
      healthy = true;
      const jumped = await request(app)
        .post('/v1/verify')
        .send({ payer: TEST_PAYER, amount: '10000000', invoiceId: 42, forceRefresh: true });
      expect(jumped.body.deltaGuard.decision).toBe('publish-quorum');

      const metrics = await request(app).get('/metrics');
      expect(metrics.text).toContain(
        'oracle_delta_quorum_confirmations_total{feed="composite-trust"} 1'
      );
      expect(metrics.text).toContain('oracle_delta_holds_active 0');
    } finally {
      await close();
    }
  });
});
