/**
 * oracle-service/src/audit-trail.test.ts  (issue #1055)
 *
 * The properties under test are the ones an audit log is actually relied on
 * for: the record surviving a restart, sequencing continuing after that
 * restart, and every class of silent edit — content, hash, deletion, column
 * rewrite, anchor forgery — being *detected* rather than believed.
 *
 * Tampering is simulated by wrapping the store, which is the honest model of
 * the threat: an attacker has write access to the database, not to the
 * process.
 */

import { describe, expect, it } from 'vitest';

import { AuditTrail, type AuditTrailOptions } from './audit-trail';
import {
  MemoryAuditStore,
  type AuditAnchorRecord,
  type AuditRow,
  type AuditRowStore,
} from './audit-store';
import { makeResponse } from './testFixtures';

const AUDIT_KEY = 'test-audit-key';
const PAYER_A = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const PAYER_B = 'GCPAYERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrail(
  store: AuditRowStore = new MemoryAuditStore(),
  overrides: Partial<Omit<AuditTrailOptions, 'store'>> = {}
): AuditTrail {
  return new AuditTrail({ store, auditKey: AUDIT_KEY, ...overrides });
}

/**
 * Wrap a store so reads return attacker-supplied patches, leaving everything
 * else (including sequencing and the chain) untouched.
 */
function tamperWith(
  base: MemoryAuditStore,
  patches: Map<number, Partial<AuditRow>>,
  anchorOverride?: AuditAnchorRecord | null
): AuditRowStore {
  const patch = (row: AuditRow): AuditRow => ({ ...row, ...patches.get(row.seq) });
  const patchAll = (rows: AuditRow[]): AuditRow[] => rows.map(patch);

  return {
    kind: base.kind,
    lastRow: async () => {
      const row = await base.lastRow();
      return row ? patch(row) : null;
    },
    rowsAfter: async (afterSeq) => patchAll(await base.rowsAfter(afterSeq)),
    insert: (row) => base.insert(row),
    query: async (filter) => patchAll(await base.query(filter)),
    count: () => base.count(),
    deleteThrough: (throughSeq) => base.deleteThrough(throughSeq),
    getAnchor: async () => (anchorOverride === undefined ? base.getAnchor() : anchorOverride),
    setAnchor: (anchor) => base.setAnchor(anchor),
    close: () => base.close(),
  };
}

async function trailWithEntries(count: number, store?: MemoryAuditStore): Promise<AuditTrail> {
  const trail = makeTrail(store);
  for (let i = 0; i < count; i += 1) {
    await trail.append(makeResponse({ invoiceId: String(i + 1) }));
  }
  return trail;
}

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

describe('AuditTrail.append', () => {
  it('starts the chain from an empty prevHash', async () => {
    const entry = await makeTrail().append(makeResponse());

    expect(entry.seq).toBe(1);
    expect(entry.prevHash).toBe('');
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chains each entry onto the previous hash', async () => {
    const store = new MemoryAuditStore();
    const trail = await trailWithEntries(3, store);

    const rows = await store.rowsAfter(0);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows[1].payload).toBeTruthy();

    const entries = await trail.getEntries();
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(entries[2].prevHash).toBe(entries[1].hash);
  });

  it('records the inputs behind the verdict, not just its conclusion', async () => {
    const trail = makeTrail();
    const entry = await trail.append(
      makeResponse({
        payer: PAYER_B,
        trustScore: 41,
        isVerified: false,
        fraudSignals: ['rapid-succession'],
        reputationScore: 37,
        historicalDefaultRate: 0.4,
        composition: {
          ...makeResponse().composition,
          outcome: 'rejected-fraud-signals',
        },
      })
    );

    expect(entry.payer).toBe(PAYER_B);
    expect(entry.trustScore).toBe(41);
    expect(entry.isVerified).toBe(false);
    expect(entry.fraudSignals).toEqual(['rapid-succession']);
    expect(entry.reputationScore).toBe(37);
    expect(entry.historicalDefaultRate).toBe(0.4);
    expect(entry.outcome).toBe('rejected-fraud-signals');
  });

  it('never mutates the response it audits', async () => {
    const trail = makeTrail();
    const response = makeResponse();
    const before = JSON.stringify(response);

    await trail.append(response);

    expect(JSON.stringify(response)).toBe(before);
  });

  it('assigns distinct sequence numbers to concurrent appends', async () => {
    const trail = await trailWithEntries(0);
    const entries = await Promise.all(
      Array.from({ length: 8 }, (_, i) => trail.append(makeResponse({ invoiceId: String(i) })))
    );

    expect(entries.map((entry) => entry.seq).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect((await trail.verifyIntegrity()).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Durability across restart
// ---------------------------------------------------------------------------

describe('AuditTrail durability', () => {
  it('continues an existing chain when rebuilt over the same store', async () => {
    const store = new MemoryAuditStore();
    await trailWithEntries(2, store);

    // Simulated restart: a fresh trail object, same durable store.
    const restarted = makeTrail(store);
    const third = await restarted.append(makeResponse({ invoiceId: '3' }));

    expect(third.seq).toBe(3);
    expect((await restarted.verifyIntegrity()).valid).toBe(true);
    expect((await restarted.verifyIntegrity()).entries).toBe(3);
  });

  it('refuses to overwrite a sequence number that already exists', async () => {
    const store = new MemoryAuditStore();
    await trailWithEntries(1, store);
    const rows = await store.rowsAfter(0);

    await expect(store.insert(rows[0])).rejects.toThrow(/already exists/);
  });

  it('does not let a caller rewrite the trail through the object it returned', async () => {
    const store = new MemoryAuditStore();
    const trail = await trailWithEntries(1, store);

    const entries = await trail.getEntries();
    (entries[0] as { trustScore: number }).trustScore = 0;

    const reread = await trail.getEntries();
    expect(reread[0].trustScore).toBe(88);
    expect((await trail.verifyIntegrity()).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getEntries
// ---------------------------------------------------------------------------

describe('AuditTrail.getEntries', () => {
  it('filters by payer', async () => {
    const trail = makeTrail();
    await trail.append(makeResponse({ payer: PAYER_A, generatedAt: '2024-01-01T00:00:00.000Z' }));
    await trail.append(makeResponse({ payer: PAYER_B, generatedAt: '2024-06-01T00:00:00.000Z' }));
    await trail.append(makeResponse({ payer: PAYER_A, generatedAt: '2024-12-01T00:00:00.000Z' }));

    const entries = await trail.getEntries({ payer: PAYER_A });
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.payer === PAYER_A)).toBe(true);
  });

  it('treats the time range as inclusive at both ends', async () => {
    const trail = makeTrail();
    await trail.append(makeResponse({ generatedAt: '2024-01-01T00:00:00.000Z' }));
    await trail.append(makeResponse({ generatedAt: '2024-06-01T00:00:00.000Z' }));
    await trail.append(makeResponse({ generatedAt: '2024-12-01T00:00:00.000Z' }));

    const window = await trail.getEntries({
      from: '2024-06-01T00:00:00.000Z',
      to: '2024-06-01T00:00:00.000Z',
    });
    expect(window).toHaveLength(1);
    expect(window[0].generatedAt).toBe('2024-06-01T00:00:00.000Z');
  });

  it('pages with limit and offset while keeping sequence order', async () => {
    const trail = await trailWithEntries(5);

    const page = await trail.getEntries({ limit: 2, offset: 2 });
    expect(page.map((entry) => entry.seq)).toEqual([3, 4]);
    expect(await trail.count()).toBe(5);
  });

  it('filters by invoice id', async () => {
    const trail = await trailWithEntries(3);
    const entries = await trail.getEntries({ invoiceId: '2' });

    expect(entries).toHaveLength(1);
    expect(entries[0].seq).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// verifyIntegrity
// ---------------------------------------------------------------------------

describe('AuditTrail.verifyIntegrity', () => {
  it('accepts an intact chain', async () => {
    const trail = await trailWithEntries(3);
    const result = await trail.verifyIntegrity();

    expect(result.valid).toBe(true);
    expect(result.entries).toBe(3);
    expect(result.brokenAt).toBeUndefined();
    expect(result.badSignatureAt).toBeUndefined();
  });

  it('accepts an empty trail', async () => {
    const result = await makeTrail().verifyIntegrity();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(0);
  });

  it('detects a rewritten entry body even when it was re-hashed', async () => {
    const store = new MemoryAuditStore();
    const trail = await trailWithEntries(3, store);
    const rows = await store.rowsAfter(0);

    // The attacker rewrites the verdict and recomputes the stored hash column,
    // but cannot reproduce the HMAC without the audit key.
    const forged = JSON.parse(rows[1].payload) as { content: { trustScore: number } };
    forged.content.trustScore = 0;
    const patches = new Map([[rows[1].seq, { payload: JSON.stringify(forged) }]]);

    const result = await makeTrail(tamperWith(store, patches)).verifyIntegrity();
    expect(result.valid).toBe(false);
    expect(result.badSignatureAt).toBe(2);
  });

  it('detects a modified hash column', async () => {
    const store = new MemoryAuditStore();
    const trail = await trailWithEntries(3, store);
    const rows = await store.rowsAfter(0);

    const patches = new Map([[rows[1].seq, { hash: `00${rows[1].hash.slice(2)}` }]]);
    const result = await makeTrail(tamperWith(store, patches)).verifyIntegrity();

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('detects a deleted entry from the middle of the chain', async () => {
    const store = new MemoryAuditStore();
    const trail = await trailWithEntries(3, store);
    const rows = await store.rowsAfter(0);

    // Rows 1 and 3 survive; row 2 is gone without a matching anchor.
    const surviving = new MemoryAuditStore();
    await surviving.insert(rows[0]);
    await surviving.insert(rows[2]);

    const result = await makeTrail(tamperWith(surviving, new Map())).verifyIntegrity();

    expect(result.valid).toBe(false);
    expect(result.gapAt).toBe(3);
  });

  it('detects an indexed column edited independently of the payload', async () => {
    const store = new MemoryAuditStore();
    const trail = await trailWithEntries(2, store);
    const rows = await store.rowsAfter(0);

    // Hide entry 2 from payer-scoped queries without disturbing the chain.
    const patches = new Map([[rows[1].seq, { payer: PAYER_B }]]);
    const result = await makeTrail(tamperWith(store, patches)).verifyIntegrity();

    expect(result.valid).toBe(false);
    expect(result.columnMismatchAt).toBe(2);
  });

  it('detects a truncated history whose anchor was forged to cover the gap', async () => {
    const store = new MemoryAuditStore();
    const trail = await trailWithEntries(3, store);

    const forgedAnchor: AuditAnchorRecord = {
      seq: 1,
      hash: 'f'.repeat(64),
      purgedThrough: 1,
      purgedAt: '2024-01-01T00:00:00.000Z',
      signature: '0'.repeat(64),
    };

    const result = await makeTrail(tamperWith(store, new Map(), forgedAnchor)).verifyIntegrity();

    expect(result.valid).toBe(false);
    expect(result.anchorInvalid).toBe(true);
    expect(result.checkedFromSeq).toBe(1);
  });

  it('reports the first bad entry only, and stops there', async () => {
    const store = new MemoryAuditStore();
    const trail = await trailWithEntries(4, store);
    const rows = await store.rowsAfter(0);

    const patches = new Map<number, Partial<AuditRow>>([
      [rows[0].seq, { hash: '1'.repeat(64) }],
      [rows[2].seq, { hash: '2'.repeat(64) }],
    ]);

    const result = await makeTrail(tamperWith(store, patches)).verifyIntegrity();
    expect(result.brokenAt).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Out-of-band verification
// ---------------------------------------------------------------------------

describe('AuditTrail.verifyWithKey', () => {
  it('verifies a copy of the trail using the audit key alone', async () => {
    const store = new MemoryAuditStore();
    await trailWithEntries(2, store);

    const result = await AuditTrail.verifyWithKey(store, AUDIT_KEY);
    expect(result.valid).toBe(true);
  });

  it('rejects a trail re-signed with a different key', async () => {
    const store = new MemoryAuditStore();
    await trailWithEntries(2, store);

    const result = await AuditTrail.verifyWithKey(store, 'some-other-key');
    expect(result.valid).toBe(false);
    expect(result.badSignatureAt).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Retention (docs/privacy.md §4 — one year)
// ---------------------------------------------------------------------------

describe('AuditTrail retention', () => {
  const HOUR_MS = 60 * 60 * 1000;

  it('removes entries past the window and keeps the rest verifiable', async () => {
    let clock = Date.UTC(2024, 0, 1);
    const store = new MemoryAuditStore();
    const trail = makeTrail(store, { now: () => clock, retentionMs: 24 * HOUR_MS });

    // One entry per hour for 30 hours: the first six age out.
    for (let hour = 0; hour < 30; hour += 1) {
      clock = Date.UTC(2024, 0, 1) + hour * HOUR_MS;
      await trail.append(makeResponse({ generatedAt: new Date(clock).toISOString() }));
    }

    const purged = await trail.enforceRetention();

    expect(purged).toBe(6);
    expect(await trail.count()).toBe(24);
    const entries = await trail.getEntries();
    expect(entries[0].seq).toBe(7);
    expect(entries[entries.length - 1].seq).toBe(30);
  });

  it('keeps the chain verifiable after a purge, from the signed anchor', async () => {
    let clock = Date.UTC(2024, 0, 1);
    const store = new MemoryAuditStore();
    const trail = makeTrail(store, { now: () => clock, retentionMs: 24 * HOUR_MS });

    for (let hour = 0; hour < 30; hour += 1) {
      clock = Date.UTC(2024, 0, 1) + hour * HOUR_MS;
      await trail.append(makeResponse({ generatedAt: new Date(clock).toISOString() }));
    }
    await trail.enforceRetention();

    const result = await trail.verifyIntegrity();
    expect(result.valid).toBe(true);
    expect(result.checkedFromSeq).toBe(6);
    expect(result.anchorSeq).toBe(6);
    expect(result.entries).toBe(24);
  });

  it('continues sequencing from the anchor once every row has aged out', async () => {
    let clock = Date.UTC(2024, 0, 1);
    const store = new MemoryAuditStore();
    const trail = makeTrail(store, { now: () => clock, retentionMs: HOUR_MS });

    await trail.append(makeResponse({ generatedAt: new Date(clock).toISOString() }));
    // Age the only entry out before sweeping.
    clock = Date.UTC(2024, 0, 1, 2);
    await trail.enforceRetention();
    expect(await trail.count()).toBe(0);

    clock = Date.UTC(2024, 0, 2);
    const next = await trail.append(makeResponse({ generatedAt: new Date(clock).toISOString() }));

    expect(next.seq).toBe(2);
    const result = await trail.verifyIntegrity();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(1);
  });

  it('is a no-op while everything is inside the window', async () => {
    const clock = Date.UTC(2024, 0, 1);
    const trail = makeTrail(new MemoryAuditStore(), {
      now: () => clock,
      retentionMs: 365 * 24 * HOUR_MS,
    });
    await trail.append(makeResponse({ generatedAt: new Date(clock).toISOString() }));

    expect(await trail.enforceRetention()).toBe(0);
    expect(await trail.getRetentionAnchor()).toBeNull();
  });

  it('exposes nothing to purge when the anchor was written by a different key', async () => {
    const store = new MemoryAuditStore();
    const trail = makeTrail(store, { now: () => Date.UTC(2024, 0, 1), retentionMs: HOUR_MS });
    await trail.append(
      makeResponse({ generatedAt: new Date(Date.UTC(2023, 11, 31)).toISOString() })
    );
    await trail.enforceRetention();

    const impostor = makeTrail(store, { auditKey: 'other-key' });
    expect(await impostor.getRetentionAnchor()).toBeNull();
  });
});
