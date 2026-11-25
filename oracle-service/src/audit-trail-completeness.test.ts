import { describe, expect, it } from 'vitest';
import { AuditTrail, type FailoverAuditParams, type AuthorizationAuditParams } from './audit-trail';
import { MemoryAuditStore } from './audit-store';
import { makeResponse, TEST_PAYER } from './testFixtures';

function createTrail(store = new MemoryAuditStore(), auditKey = 'test-audit-completeness-key'): AuditTrail {
  return new AuditTrail({ store, auditKey });
}

describe('Audit trail completeness (#1486)', () => {
  it('appends and chains verification, failover, and authorization events seamlessly', async () => {
    const store = new MemoryAuditStore();
    const trail = createTrail(store);

    // 1. Verification event
    const vEntry = await trail.appendVerification(makeResponse({ payer: TEST_PAYER, invoiceId: 'inv-101' }));
    expect(vEntry.seq).toBe(1);
    expect(vEntry.eventType).toBe('verification');
    expect(vEntry.prevHash).toBe('');

    // 2. Failover event
    const fParams: FailoverAuditParams = {
      sourceId: 'kyb-primary',
      primaryProvider: 'vendor-kyb',
      fallbackProvider: 'backup-kyb',
      reason: 'HTTP 503 Service Unavailable',
      durationMs: 450,
      triggerPayer: TEST_PAYER,
    };
    const fEntry = await trail.appendFailover(fParams);
    expect(fEntry.seq).toBe(2);
    expect(fEntry.eventType).toBe('failover');
    expect(fEntry.prevHash).toBe(vEntry.hash);
    expect(fEntry.failoverDetails?.primaryProvider).toBe('vendor-kyb');
    expect(fEntry.failoverDetails?.fallbackProvider).toBe('backup-kyb');

    // 3. Authorization event
    const aParams: AuthorizationAuditParams = {
      action: 'bearer_auth',
      actor: 'admin:service-role',
      permitted: true,
      keyId: 'key-rot-2026',
    };
    const aEntry = await trail.appendAuthorization(aParams);
    expect(aEntry.seq).toBe(3);
    expect(aEntry.eventType).toBe('authorization');
    expect(aEntry.prevHash).toBe(fEntry.hash);
    expect(aEntry.authorizationDetails?.action).toBe('bearer_auth');
    expect(aEntry.authorizationDetails?.permitted).toBe(true);

    // Verify entire mixed chain integrity
    const integrity = await trail.verifyIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.entries).toBe(3);

    // Verify completeness report
    const completeness = await trail.verifyCompleteness();
    expect(completeness.complete).toBe(true);
    expect(completeness.totalEntries).toBe(3);
    expect(completeness.verificationCount).toBe(1);
    expect(completeness.failoverCount).toBe(1);
    expect(completeness.authorizationCount).toBe(1);
    expect(completeness.gaps).toEqual([]);
  });

  it('filters entries by eventType in getEntries and count', async () => {
    const trail = createTrail();

    await trail.appendVerification(makeResponse({ invoiceId: '1' }));
    await trail.appendFailover({
      sourceId: 'indexer',
      primaryProvider: 'p1',
      fallbackProvider: 'p2',
      reason: 'timeout',
    });
    await trail.appendVerification(makeResponse({ invoiceId: '2' }));
    await trail.appendAuthorization({
      action: 'admin_api',
      actor: 'operator-1',
      permitted: false,
      reason: 'InvalidSignature',
    });

    const verifications = await trail.getEntries({ eventType: 'verification' });
    const failovers = await trail.getEntries({ eventType: 'failover' });
    const authorizations = await trail.getEntries({ eventType: 'authorization' });

    expect(verifications).toHaveLength(2);
    expect(failovers).toHaveLength(1);
    expect(authorizations).toHaveLength(1);

    expect(await trail.count({ eventType: 'verification' })).toBe(2);
    expect(await trail.count({ eventType: 'failover' })).toBe(1);
    expect(await trail.count({ eventType: 'authorization' })).toBe(1);
  });

  it('detects missing events (sequence gaps) in verifyCompleteness', async () => {
    const store = new MemoryAuditStore();
    const trail = createTrail(store);

    await trail.appendVerification(makeResponse({ invoiceId: '1' }));
    await trail.appendFailover({
      sourceId: 'kyb',
      primaryProvider: 'p1',
      fallbackProvider: 'p2',
      reason: 'timeout',
    });
    await trail.appendAuthorization({
      action: 'key_rotation',
      actor: 'kms',
      permitted: true,
    });

    // Delete row 2 (failover) to simulate malicious excision
    await store.deleteThrough(2); // Deletes rows 1 and 2

    // Re-insert row 1 only, so row 2 is missing while row 3 exists
    const rows = await store.rowsAfter(0);
    // Rows currently contains only row 3
    expect(rows).toHaveLength(1);
    expect(rows[0].seq).toBe(3);

    const completeness = await trail.verifyCompleteness();
    expect(completeness.complete).toBe(false);
    expect(completeness.gaps).toContain(3); // Sequence 3 does not follow sequence 1
  });

  it('detects tampering of failover event details', async () => {
    const store = new MemoryAuditStore();
    const trail = createTrail(store);

    await trail.appendFailover({
      sourceId: 'kyb-primary',
      primaryProvider: 'vendor-kyb',
      fallbackProvider: 'backup-kyb',
      reason: 'HTTP 503',
    });

    const rows = await store.rowsAfter(0);
    expect(rows).toHaveLength(1);

    // Tamper with payload
    const tampered = { ...rows[0], payload: rows[0].payload.replace('vendor-kyb', 'evil-vendor') };
    const tamperedStore = new MemoryAuditStore();
    await tamperedStore.insert(tampered);

    const check = await createTrail(tamperedStore).verifyIntegrity();
    expect(check.valid).toBe(false);
    expect(check.badSignatureAt).toBe(1);
  });

  it('serializes concurrent mixed event appends without race conditions or forks', async () => {
    const trail = createTrail();

    // Fire 10 mixed appends simultaneously
    const tasks = [
      trail.appendVerification(makeResponse({ invoiceId: 'c-1' })),
      trail.appendFailover({ sourceId: 'src-1', primaryProvider: 'a', fallbackProvider: 'b', reason: 'err' }),
      trail.appendAuthorization({ action: 'bearer_auth', actor: 'user-1', permitted: true }),
      trail.appendVerification(makeResponse({ invoiceId: 'c-2' })),
      trail.appendFailover({ sourceId: 'src-2', primaryProvider: 'c', fallbackProvider: 'd', reason: 'err' }),
      trail.appendAuthorization({ action: 'admin_api', actor: 'admin-1', permitted: false }),
      trail.appendVerification(makeResponse({ invoiceId: 'c-3' })),
      trail.appendVerification(makeResponse({ invoiceId: 'c-4' })),
      trail.appendFailover({ sourceId: 'src-3', primaryProvider: 'e', fallbackProvider: 'f', reason: 'err' }),
      trail.appendAuthorization({ action: 'key_rotation', actor: 'secops', permitted: true }),
    ];

    const results = await Promise.all(tasks);
    const seqs = results.map((r) => r.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const completeness = await trail.verifyCompleteness();
    expect(completeness.complete).toBe(true);
    expect(completeness.totalEntries).toBe(10);
    expect(completeness.verificationCount).toBe(4);
    expect(completeness.failoverCount).toBe(3);
    expect(completeness.authorizationCount).toBe(3);
  });
});
