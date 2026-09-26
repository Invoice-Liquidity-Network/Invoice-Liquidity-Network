import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { createOracleApp, startOracleService } from './index';
import { OracleSigningKeyStore } from './signer';
import { MemoryAuditStore, type AuditRowStore } from './audit-store';
import {
  TEST_PAYER,
  fraudulentHistory,
  healthyHistory,
  makeExternal,
  makeReputation,
} from './testFixtures';
import type { CreateOracleAppResult } from './index';

/**
 * HTTP surface and wiring for the oracle service: route behaviour, provider
 * construction, metrics emission and the cache-invalidation endpoint.
 */

const NOW = Date.now();
const VALID_BODY = { payer: TEST_PAYER, amount: '10000000', invoiceId: 42 };

let created: CreateOracleAppResult;

async function build(overrides: Parameters<typeof createOracleApp>[0] = {}) {
  created = await createOracleApp({
    indexerBaseUrl: 'http://indexer.local',
    historyProvider: async () => healthyHistory(NOW),
    reputationProvider: async () => makeReputation(NOW, { score: 90 }),
    ...overrides,
  });
  return created;
}

afterEach(async () => {
  await created?.close();
});

describe('health', () => {
  it('reports ok with cache kind and indexer url on both routes', async () => {
    const { app } = await build();

    for (const route of ['/health', '/v1/health']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', cache: 'memory', route });
    }
  });

  it('reports reputationConfigured when rpc url and contract id are both set', async () => {
    const { health } = await build({
      reputationRpcUrl: 'https://rpc.example',
      reputationContractId: 'CCONTRACT',
    });

    expect(health().reputationConfigured).toBe(true);
  });

  it('reports reputationConfigured false when only one is set', async () => {
    const { health } = await build({ reputationRpcUrl: 'https://rpc.example' });
    expect(health().reputationConfigured).toBe(false);
  });

  it('degrades after a verification throws', async () => {
    const { app, health } = await build({
      historyProvider: async () => {
        throw new Error('indexer down');
      },
      // The verifier tolerates a failing history provider, so force the throw
      // from a layer it cannot swallow.
      cache: {
        get: async () => {
          throw new Error('cache exploded');
        },
        set: async () => {},
      },
    });

    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Oracle verification failed');
    expect(res.body.message).toMatch(/cache exploded/);
    expect(health().status).toBe('degraded');
  });
});

describe('metrics endpoint', () => {
  it('serves prometheus exposition on both routes', async () => {
    const { app } = await build();

    for (const route of ['/metrics', '/v1/metrics']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('oracle_verification_requests_total');
    }
  });

  it('records outcome, cache and duration metrics for a verification', async () => {
    const { app } = await build();

    await request(app).post('/v1/verify').send(VALID_BODY);
    const first = await request(app).get('/metrics');

    expect(first.text).toMatch(/oracle_verification_requests_total 1/);
    expect(first.text).toContain('oracle_verification_outcome_total');
    expect(first.text).toMatch(/oracle_cache_misses_total 1/);

    // A second identical request is a cache hit.
    await request(app).post('/v1/verify').send(VALID_BODY);
    const second = await request(app).get('/metrics');
    expect(second.text).toMatch(/oracle_cache_hits_total 1/);
  });

  it('records fraud signals when the heuristics fire', async () => {
    const { app } = await build({ historyProvider: async () => fraudulentHistory(NOW) });

    await request(app).post('/v1/verify').send(VALID_BODY);
    const res = await request(app).get('/metrics');

    expect(res.text).toContain('oracle_fraud_signal_total');
    expect(res.text).toMatch(/oracle_fraud_flag_ratio 1/);
  });

  it('counts a stale response', async () => {
    const { app } = await build({
      maxOracleAgeMs: 1,
      historyProvider: async () => healthyHistory(NOW - 10 * 24 * 60 * 60 * 1000),
      reputationProvider: async () =>
        makeReputation(NOW - 10 * 24 * 60 * 60 * 1000, { score: 90 }),
    });

    await request(app).post('/v1/verify').send(VALID_BODY);
    const res = await request(app).get('/metrics');

    expect(res.text).toMatch(/oracle_stale_responses_total 1/);
  });
});

describe('POST /verify validation', () => {
  it('accepts the unversioned /verify route', async () => {
    const { app } = await build();
    const res = await request(app).post('/verify').send(VALID_BODY);
    expect(res.status).toBe(200);
  });

  it.each([
    ['missing payer', { amount: '1', invoiceId: 1 }],
    ['missing amount', { payer: TEST_PAYER, invoiceId: 1 }],
    ['missing invoiceId', { payer: TEST_PAYER, amount: '1' }],
    ['null invoiceId', { payer: TEST_PAYER, amount: '1', invoiceId: null }],
    ['empty body', {}],
  ])('rejects %s with 400', async (_label, body) => {
    const { app } = await build();
    const res = await request(app).post('/v1/verify').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('rejects a malformed stellar address', async () => {
    const { app } = await build();
    const res = await request(app)
      .post('/v1/verify')
      .send({ ...VALID_BODY, payer: 'not-an-address' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid Stellar address/);
  });

  it('accepts the invoiceAmount and invoice_id aliases', async () => {
    const { app } = await build();
    const res = await request(app)
      .post('/v1/verify')
      .send({ payer: TEST_PAYER, invoiceAmount: '10000000', invoice_id: 7 });

    expect(res.status).toBe(200);
    expect(res.body.invoiceId).toBe('7');
  });

  it.each([[true], ['true'], [1], ['1']])(
    'treats forceRefresh=%p as truthy',
    async (forceRefresh) => {
      let calls = 0;
      const { app } = await build({
        historyProvider: async () => {
          calls += 1;
          return healthyHistory(NOW);
        },
      });

      await request(app).post('/v1/verify').send(VALID_BODY);
      await request(app)
        .post('/v1/verify')
        .send({ ...VALID_BODY, forceRefresh });

      expect(calls).toBe(2);
    }
  );

  it('honours a numeric maxOracleAgeMs override from the body', async () => {
    const { app } = await build();
    const res = await request(app)
      .post('/v1/verify')
      .send({ ...VALID_BODY, maxOracleAgeMs: 1 });

    expect(res.status).toBe(200);
    expect(res.body.composition.outcome).toBe('rejected-stale-data');
  });

  it('rejects GET /v1/verify with 405', async () => {
    const { app } = await build();
    const res = await request(app).get('/v1/verify');

    expect(res.status).toBe(405);
    expect(res.body.error).toMatch(/Use POST/);
  });
});

describe('composition surfaced over HTTP', () => {
  it('returns both sub-scores so the badge can distinguish cases', async () => {
    const { app } = await build({
      externalProvider: async () => makeExternal({ status: 'verified', provider: 'acme-kyb' }),
    });

    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.body.composition.outcome).toBe('verified-both');
    expect(res.body.composition.heuristic.passed).toBe(true);
    expect(res.body.composition.external).toMatchObject({
      status: 'verified',
      provider: 'acme-kyb',
    });
  });

  it('reports a KYB-verified payer that trips fraud heuristics as rejected', async () => {
    const { app } = await build({
      historyProvider: async () => fraudulentHistory(NOW),
      externalProvider: async () => makeExternal({ status: 'verified' }),
    });

    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.body.isVerified).toBe(false);
    expect(res.body.composition.outcome).toBe('rejected-fraud-signals');
    expect(res.body.composition.external.status).toBe('verified');
  });
});

describe('POST /v1/cache/invalidate', () => {
  it('drops cached verdicts for the payer', async () => {
    const { app } = await build();

    await request(app).post('/v1/verify').send(VALID_BODY);
    const res = await request(app).post('/v1/cache/invalidate').send({ payer: TEST_PAYER });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ payer: TEST_PAYER, invalidated: 1 });

    // The next request recomputes rather than serving the dropped entry.
    const after = await request(app).post('/v1/verify').send(VALID_BODY);
    expect(after.body.cacheHit).toBe(false);
  });

  it('rejects a malformed or missing payer', async () => {
    const { app } = await build();

    for (const body of [{}, { payer: '' }, { payer: 'nope' }]) {
      const res = await request(app).post('/v1/cache/invalidate').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valid Stellar address/);
    }
  });

  it('reports zero when nothing was cached for that payer', async () => {
    const { app } = await build();
    const res = await request(app).post('/v1/cache/invalidate').send({ payer: TEST_PAYER });

    expect(res.body.invalidated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #1053 — every publication has to be attributable
// ---------------------------------------------------------------------------

const SIGNING_KEY = 'test-oracle-signing-key';
/** A second valid public key, so a payer filter can be shown to actually filter. */
const OTHER_PAYER = 'GCPAYERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function newKeyStore(
  overrides: Partial<ConstructorParameters<typeof OracleSigningKeyStore>[0]> = {}
): OracleSigningKeyStore {
  return new OracleSigningKeyStore({
    currentKey: SIGNING_KEY,
    currentKeyId: 'v1',
    ...overrides,
  });
}

describe('verdict attestation (#1053)', () => {
  it('signs each publication over exactly the body it returns', async () => {
    const store = newKeyStore();
    const { app, health } = await build({ signingKeyStore: store });

    const first = await request(app).post('/v1/verify').send(VALID_BODY);
    const second = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(health().signing).toBe('enabled');
    for (const res of [first, second]) {
      expect(res.status).toBe(200);
      const { attestation, ...verdict } = res.body;
      expect(attestation).toMatchObject({ keyId: 'v1', nonce: expect.any(String) });
      // The signature covers the verdict as serialised by the oracle. A consumer
      // that re-marshalled the body would not reproduce these bytes, which is why
      // `payload` — not the response object — is what must be checked.
      expect(JSON.parse(attestation.payload)).toEqual(verdict);
      expect(store.verifySignedUpdate(attestation)).toEqual({
        valid: true,
        usedPreviousKey: false,
      });
    }

    // Attestations are minted per publication rather than cached with the verdict:
    // the second request hit the cache yet still got its own nonce, so a
    // consumer's replay cache counts publications instead of verdicts.
    expect(second.body.cacheHit).toBe(true);
    expect(second.body.attestation.nonce).not.toBe(first.body.attestation.nonce);
    expect(store.verifySignedUpdate(first.body.attestation)).toMatchObject({
      valid: false,
      code: 'replayed_nonce',
    });
  });

  it('serves an unsigned verdict when no key is configured', async () => {
    const { app, health } = await build({ signingKeyStore: null });

    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.attestation).toBeUndefined();
    expect(health().signing).toBe('disabled');
  });

  it('publishes the active key id and its rotation window', async () => {
    const rotationStartedAt = 1_700_000_000_000;
    const { app } = await build({
      signingKeyStore: newKeyStore({
        currentKeyId: 'v2',
        previousKey: 'the-outgoing-key',
        previousKeyId: 'v1',
        rotationStartedAt,
        rotationWindowMs: 60_000,
        now: () => rotationStartedAt + 30_000,
      }),
    });

    const res = await request(app).get('/v1/signing/config');

    expect(res.status).toBe(200);
    // Verifiers are configured against this document rather than being told out
    // of band, so both ids and the expiry have to be readable from it.
    expect(res.body).toMatchObject({
      currentKeyId: 'v2',
      previousKeyId: 'v1',
      rotationWindowOpen: true,
    });
    expect(res.body.rotationExpiresAt).toBe(new Date(rotationStartedAt + 60_000).toISOString());
  });

  it('refuses the signing config while signing is unconfigured', async () => {
    const { app } = await build({ signingKeyStore: null });

    const res = await request(app).get('/v1/signing/config');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/signing is not configured/);
  });

  describe('key store resolution', () => {
    const envKeys = ['NODE_ENV', 'ORACLE_SIGNING_KEY', 'ORACLE_SIGNING_KEY_ID'] as const;
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = {};
      for (const key of envKeys) saved[key] = process.env[key];
    });

    afterEach(() => {
      for (const key of envKeys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });

    it('builds a store from ORACLE_SIGNING_KEY when no option is supplied', async () => {
      process.env.ORACLE_SIGNING_KEY = 'key-from-env';
      process.env.ORACLE_SIGNING_KEY_ID = 'env-v9';

      const { app, health } = await build();
      const config = await request(app).get('/v1/signing/config');

      expect(health().signing).toBe('enabled');
      expect(config.body.currentKeyId).toBe('env-v9');
    });

    it('refuses to boot in production without a key', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ORACLE_SIGNING_KEY;

      // An explicit store sidesteps the audit driver's own production guard, so
      // the failure under test is the missing signing key and nothing else.
      await expect(
        build({ auditStore: new MemoryAuditStore(), signingKeyStore: undefined })
      ).rejects.toThrow(/refuses to start in production without ORACLE_SIGNING_KEY/);
    });

    it('stays unsigned outside production', async () => {
      delete process.env.NODE_ENV;
      delete process.env.ORACLE_SIGNING_KEY;

      const { health } = await build({ signingKeyStore: undefined });
      expect(health().signing).toBe('disabled');
    });
  });
});

// ---------------------------------------------------------------------------
// #1055 — the read surface over the audit trail
// ---------------------------------------------------------------------------

/**
 * A store that forwards everything to `base`, so a test can spread it and
 * override the single method it wants to make misbehave.
 */
function storeDelegatingTo(base: MemoryAuditStore): AuditRowStore {
  return {
    kind: base.kind,
    lastRow: () => base.lastRow(),
    rowsAfter: (afterSeq) => base.rowsAfter(afterSeq),
    insert: (row) => base.insert(row),
    query: (filter) => base.query(filter),
    count: (filter) => base.count(filter),
    deleteThrough: (throughSeq) => base.deleteThrough(throughSeq),
    getAnchor: () => base.getAnchor(),
    setAnchor: (anchor) => base.setAnchor(anchor),
    close: () => base.close(),
  };
}

/** Publish `count` distinct verdicts through the running app. */
async function trailWith(count: number) {
  const built = await build();
  for (let i = 0; i < count; i += 1) {
    const res = await request(built.app)
      .post('/v1/verify')
      .send({ ...VALID_BODY, invoiceId: 100 + i });
    expect(res.status).toBe(200);
  }
  return built;
}

describe('GET /v1/audit/entries (#1055)', () => {
  it('returns the published verdicts oldest first with their chain links', async () => {
    const { app } = await trailWith(2);

    const res = await request(app).get('/v1/audit/entries');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    // docs/privacy.md §4 caps oracle attestation logs at one year.
    expect(res.body.retainedForMs).toBe(365 * 24 * 60 * 60 * 1000);
    expect(res.body.entries.map((entry: { seq: number }) => entry.seq)).toEqual([1, 2]);
    expect(res.body.entries[0]).toMatchObject({
      payer: TEST_PAYER,
      invoiceId: '100',
      amount: '10000000',
      outcome: 'verified-heuristic-only',
    });
    // The audit value is the reconstruction of *why*, so the decision inputs are
    // stored alongside the decision.
    expect(res.body.entries[0]).toHaveProperty('trustScore');
    expect(res.body.entries[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.entries[1].prevHash).toBe(res.body.entries[0].hash);
  });

  it('counts what the filter matched so a filtered page can be paged', async () => {
    const { app } = await trailWith(3);

    const one = await request(app).get('/v1/audit/entries').query({ invoiceId: '101' });
    expect(one.body.total).toBe(1);
    expect(one.body.entries.map((e: { invoiceId: string }) => e.invoiceId)).toEqual(['101']);

    const payer = await request(app).get('/v1/audit/entries').query({ payer: TEST_PAYER });
    expect(payer.body.total).toBe(3);

    const nobody = await request(app).get('/v1/audit/entries').query({ payer: OTHER_PAYER });
    expect(nobody.body).toMatchObject({ total: 0, entries: [] });

    // Paging narrows the page, never the total behind it.
    const paged = await request(app).get('/v1/audit/entries').query({ limit: 1, offset: 2 });
    expect(paged.body.total).toBe(3);
    expect(paged.body.entries.map((e: { seq: number }) => e.seq)).toEqual([3]);
  });

  it('accepts date-only bounds and treats them as inclusive', async () => {
    const { app } = await trailWith(2);

    const spanning = await request(app)
      .get('/v1/audit/entries')
      .query({ from: '2000-01-01', to: '2999-12-31' });
    expect(spanning.body.total).toBe(2);

    const before = await request(app).get('/v1/audit/entries').query({ to: '2000-01-01' });
    expect(before.body).toMatchObject({ total: 0, entries: [] });
  });

  it.each([
    ['from', 'today'],
    ['to', 'the usual tuesday'],
  ])('rejects an unparseable %s bound', async (name, value) => {
    const { app } = await build();

    const res = await request(app).get('/v1/audit/entries').query({ [name]: value });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`${name} must be an ISO-8601 timestamp`);
  });

  it('rejects a reversed range instead of quietly returning nothing', async () => {
    const { app } = await build();

    const res = await request(app)
      .get('/v1/audit/entries')
      .query({ from: '2024-06-02T00:00:00Z', to: '2024-06-01T00:00:00Z' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from must not be after to/);
  });

  it('rejects a malformed payer filter and ignores an empty one', async () => {
    const { app } = await trailWith(1);

    const bad = await request(app).get('/v1/audit/entries').query({ payer: 'nope' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/valid Stellar address/);

    const blank = await request(app).get('/v1/audit/entries').query({ payer: '   ' });
    expect(blank.body.total).toBe(1);
  });

  it.each([
    ['zero', { limit: '0' }],
    ['above the page cap', { limit: '1001' }],
    ['not a number', { limit: 'everything' }],
    ['a negative offset', { offset: '-1' }],
    ['a fractional offset', { offset: '1.5' }],
  ])('rejects a limit that is %s', async (_label, query) => {
    const { app } = await build();

    const res = await request(app).get('/v1/audit/entries').query(query);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit|offset/);
  });

  it('caps the page at the built-in maximum', async () => {
    const { app } = await build();

    const res = await request(app).get('/v1/audit/entries').query({ limit: '1000' });

    expect(res.status).toBe(200);
  });

  it('answers 500 rather than hanging when a stored row cannot be read back', async () => {
    const base = new MemoryAuditStore();
    // Rows are written honestly and then read back damaged — the store is the
    // untrusted layer. Express 4 does not forward a rejected async handler to its
    // error middleware, so without the route's own guard this request would hang
    // until the client gave up and the failure would surface only as an
    // unhandled rejection in the service log.
    const corrupt: AuditRowStore = {
      ...storeDelegatingTo(base),
      query: async (filter) =>
        (await base.query(filter)).map((row) => ({ ...row, payload: 'not json' })),
    };

    const built = await build({ auditStore: corrupt });
    await request(built.app).post('/v1/verify').send(VALID_BODY);

    const res = await request(built.app).get('/v1/audit/entries');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Oracle audit query failed');
    expect(res.body.message).toMatch(/unreadable payload/);
  });
});

describe('GET /v1/audit/integrity (#1055)', () => {
  it('reports an untouched chain as valid', async () => {
    const { app } = await trailWith(2);

    const res = await request(app).get('/v1/audit/integrity');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ valid: true, entries: 2, checkedFromSeq: 0 });
    expect(res.body.checkedAt).toMatch(/Z$/);
  });

  it('answers 500 and counts a store whose columns disagree with its payloads', async () => {
    const base = new MemoryAuditStore();
    // The honest threat model: write access to the database, not to the process.
    // Editing an indexed projection hides a payer from a range query while the
    // payload chain still verifies, so the read path would report "clean".
    const tampered: AuditRowStore = {
      ...storeDelegatingTo(base),
      rowsAfter: async (afterSeq) =>
        (await base.rowsAfter(afterSeq)).map((row) =>
          row.seq === 1 ? { ...row, trustScore: row.trustScore - 1 } : row
        ),
    };

    const built = await build({ auditStore: tampered });
    await request(built.app).post('/v1/verify').send(VALID_BODY);
    await request(built.app).post('/v1/verify').send({ ...VALID_BODY, invoiceId: 43 });

    const res = await request(built.app).get('/v1/audit/integrity');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ valid: false, columnMismatchAt: 1, entries: 2 });

    // A broken chain is an incident, not a query result: it is counted so the
    // alert rules can watch it without anyone polling this endpoint.
    expect((await request(built.app).get('/metrics')).text).toMatch(
      /oracle_audit_integrity_failures_total 1/
    );
    await request(built.app).get('/v1/audit/integrity');
    expect((await request(built.app).get('/metrics')).text).toMatch(
      /oracle_audit_integrity_failures_total 2/
    );
  });

  it('starts the walk from the signed anchor after a retention purge', async () => {
    // A zero-length window keeps nothing, so the entry published below is already
    // out of retention by the time the sweep runs. That is what makes the purge
    // deterministic instead of depending on how long the test took.
    const built = await build({ auditRetentionMs: 0 });
    await request(built.app).post('/v1/verify').send(VALID_BODY);
    expect((await request(built.app).get('/v1/audit/entries')).body.total).toBe(1);

    // The same call the hourly timer makes.
    expect(await built.auditTrail.enforceRetention()).toBe(1);
    // Deleting history is only legitimate if what went is provable: the purge
    // leaves a signed anchor behind, not just a shorter table.
    await expect(built.auditTrail.getRetentionAnchor()).resolves.toMatchObject({
      seq: 1,
      purgedThrough: 1,
    });

    const res = await request(built.app).get('/v1/audit/integrity');

    // Purged rows are not a gap: the walk resumes from the signed anchor, so a
    // truncated history stays verifiable instead of reporting itself broken.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ valid: true, entries: 0, anchorSeq: 1, checkedFromSeq: 1 });
    expect((await request(built.app).get('/v1/audit/entries')).body.total).toBe(0);
  });

  it('answers 500 when the chain walk itself fails', async () => {
    const base = new MemoryAuditStore();
    const broken: AuditRowStore = {
      ...storeDelegatingTo(base),
      rowsAfter: async () => {
        throw new Error('chain read failed');
      },
    };

    const built = await build({ auditStore: broken });
    await request(built.app).post('/v1/verify').send(VALID_BODY);

    const res = await request(built.app).get('/v1/audit/integrity');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: 'Oracle audit query failed',
      message: /chain read failed/,
    });
    // An unreadable store is not evidence of tampering: conflating the two would
    // page whoever is on call about an attack that did not happen.
    expect((await request(built.app).get('/metrics')).text).not.toMatch(
      /oracle_audit_integrity_failures_total 1/
    );
  });
});

describe('audit retention sweep', () => {
  it('logs a failing sweep and keeps the timer armed', async () => {
    const store = new MemoryAuditStore();
    let queries = 0;
    // The boot sweep is the first query the trail makes; every later one comes
    // from the hourly timer.
    const flaky: AuditRowStore = {
      ...storeDelegatingTo(store),
      query: (filter) => {
        queries += 1;
        return queries === 1
          ? store.query(filter)
          : Promise.reject(new Error('audit database is gone'));
      },
    };

    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await build({ auditStore: flaky });
      expect(error).not.toHaveBeenCalled();

      // 1 hour: AUDIT_RETENTION_SWEEP_MS in index.ts.
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(error).toHaveBeenCalledWith(
        '[oracle] audit retention sweep failed',
        expect.any(Error)
      );

      // The failed run must not have cost the service the next one.
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('default providers', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches payer history from the indexer', async () => {
    const entries = [
      {
        id: 1,
        freelancer: 'GF',
        payer: TEST_PAYER,
        amount: '10000000',
        due_date: 0,
        discount_rate: 300,
        status: 'Paid',
        funder: 'GU',
        funded_at: 1,
        created_at: 2,
        updated_at: 3,
      },
    ];
    const fetchMock = vi.fn(async (_url: unknown) =>
      new Response(JSON.stringify(entries), { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { app } = await build({ historyProvider: undefined });
    await request(app).post('/v1/verify').send(VALID_BODY);

    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v1/history/');
    expect(url).toContain('role=payer');
  });

  it('normalizes missing history fields to defaults', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify([{}]), { status: 200 })
    ) as unknown as typeof fetch;

    const { app } = await build({ historyProvider: undefined });
    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.status).toBe(200);
  });

  it('falls back to empty history when the indexer errors', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const { app } = await build({ historyProvider: undefined });
    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.evidence.join(' ')).toMatch(/No payer history/);
  });

  it('falls back to empty history when the indexer returns a non-array', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ nope: true }), { status: 200 })
    ) as unknown as typeof fetch;

    const { app } = await build({ historyProvider: undefined });
    expect((await request(app).post('/v1/verify').send(VALID_BODY)).status).toBe(200);
  });

  it('strips a trailing slash from the indexer base url', async () => {
    const fetchMock = vi.fn(async (_url: unknown) => new Response('[]', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { app } = await build({
      historyProvider: undefined,
      indexerBaseUrl: 'http://indexer.local///',
    });
    await request(app).post('/v1/verify').send(VALID_BODY);

    expect(String(fetchMock.mock.calls[0][0])).toContain('http://indexer.local/v1/history/');
  });

  it('returns a zeroed reputation when the contract is not configured', async () => {
    const { app } = await build({ reputationProvider: undefined });
    const res = await request(app).post('/v1/verify').send(VALID_BODY);

    expect(res.body.reputationScore).toBe(0);
  });
});

describe('option resolution', () => {
  const envKeys = [
    'ORACLE_PORT',
    'INDEXER_BASE_URL',
    'ORACLE_CACHE_TTL_SECONDS',
    'ORACLE_REQUEST_TIMEOUT_MS',
    'ORACLE_MAX_ORACLE_AGE_MS',
    'ORACLE_REPUTATION_RPC_URL',
    'ORACLE_REPUTATION_CONTRACT_ID',
    'REDIS_URL',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('reads defaults from the environment', async () => {
    process.env.INDEXER_BASE_URL = 'http://from-env.local';
    const { health } = await build({ indexerBaseUrl: undefined });

    expect(health().indexerBaseUrl).toBe('http://from-env.local');
  });

  it('prefers explicit options over the environment', async () => {
    process.env.INDEXER_BASE_URL = 'http://from-env.local';
    const { health } = await build({ indexerBaseUrl: 'http://explicit.local' });

    expect(health().indexerBaseUrl).toBe('http://explicit.local');
  });

  it('falls back to the built-in indexer url when neither is set', async () => {
    delete process.env.INDEXER_BASE_URL;
    const { health } = await build({ indexerBaseUrl: undefined });

    expect(health().indexerBaseUrl).toBe('http://localhost:3001');
  });
});

describe('startOracleService', () => {
  it('binds the configured port and logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Port 0 lets the OS pick a free port, so this never collides in CI.
    const server = await startOracleService({
      port: 0,
      historyProvider: async () => [],
      reputationProvider: async () => makeReputation(NOW),
    });

    expect(server.listening).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[oracle] listening on'));

    log.mockRestore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
