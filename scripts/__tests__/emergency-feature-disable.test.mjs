import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  EmergencyFeatureManager,
  EmergencyFeatureDisabledError,
  UnauthorizedAdminRequiredError,
} from '../drills/emergency-feature-disable.mjs';

describe('Emergency Feature-Disable & Circuit Breaker Suite (#1327)', () => {
  let manager;

  beforeEach(() => {
    manager = new EmergencyFeatureManager();
  });

  it('allows operations when features are enabled by default', () => {
    assert.equal(manager.isFeatureEnabled('SETTLEMENT_PAYOUTS'), true);
    assert.doesNotThrow(() => manager.assertFeatureEnabled('SETTLEMENT_PAYOUTS'));
  });

  it('blocks operation when emergency kill switch is activated by admin', () => {
    const res = manager.disableFeature('SETTLEMENT_PAYOUTS', '@sec-commander', 'Suspicious settlement activity');
    assert.equal(res.status, 'DISABLED');
    assert.equal(manager.isFeatureEnabled('SETTLEMENT_PAYOUTS'), false);

    assert.throws(
      () => manager.assertFeatureEnabled('SETTLEMENT_PAYOUTS'),
      EmergencyFeatureDisabledError
    );
  });

  it('rejects unauthorized non-admin attempts to trigger emergency disable', () => {
    assert.throws(
      () => manager.disableFeature('CONTRACT_CORE_OPERATIONS', '@malicious-user', 'Ransomware attempt'),
      UnauthorizedAdminRequiredError
    );
    assert.equal(manager.isFeatureEnabled('CONTRACT_CORE_OPERATIONS'), true);
  });

  it('handles emergency disable and restore idempotently', () => {
    manager.disableFeature('INDEXER_INGESTION', '@admin-multisig');
    const secondDisable = manager.disableFeature('INDEXER_INGESTION', '@admin-multisig');
    assert.equal(secondDisable.status, 'ALREADY_DISABLED');

    manager.enableFeature('INDEXER_INGESTION', '@admin-multisig');
    const secondEnable = manager.enableFeature('INDEXER_INGESTION', '@admin-multisig');
    assert.equal(secondEnable.status, 'ALREADY_ENABLED');
    assert.equal(manager.isFeatureEnabled('INDEXER_INGESTION'), true);
  });

  it('records chronological audit trail of all emergency actions', () => {
    manager.disableFeature('NOTIFICATIONS_DISPATCH', '@sec-commander', 'Webhook DDoS protection');
    manager.enableFeature('NOTIFICATIONS_DISPATCH', '@sec-commander');

    assert.equal(manager.auditLog.length, 2);
    assert.equal(manager.auditLog[0].action, 'EMERGENCY_DISABLE');
    assert.equal(manager.auditLog[1].action, 'EMERGENCY_RESTORE');
  });
});
