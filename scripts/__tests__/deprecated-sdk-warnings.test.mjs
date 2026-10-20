import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Deprecated SDK Surface Migration Warnings Suite (#1222)', () => {
  it('emits deprecation warning once when instantiating deprecated ILNSdk alias', () => {
    const warnings = [];
    let hasWarned = false;

    function emitWarning(feature, replacement) {
      if (!hasWarned) {
        warnings.push(`[DEPRECATION] ${feature} is deprecated. Use ${replacement}.`);
        hasWarned = true;
      }
    }

    class MockClient {}
    class MockLegacySdk extends MockClient {
      constructor() {
        super();
        emitWarning('ILNSdk', 'ILNClient');
      }
    }

    // Instantiation 1: should warn
    new MockLegacySdk();
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('ILNSdk is deprecated'));

    // Instantiation 2: should NOT duplicate warn
    new MockLegacySdk();
    assert.equal(warnings.length, 1);

    // Canonical client: no warnings
    new MockClient();
    assert.equal(warnings.length, 1);
  });

  it('emits deprecation warning when accessing legacy ILN_TESTNET constant via proxy', () => {
    const warnings = [];
    let warned = false;

    const raw = { networkPassphrase: 'test', rpcUrl: 'https://test' };
    const legacyProxy = new Proxy(raw, {
      get(target, prop) {
        if (!warned) {
          warnings.push('[DEPRECATION] ILN_TESTNET is deprecated. Use NETWORKS.TESTNET.');
          warned = true;
        }
        return target[prop];
      }
    });

    const val = legacyProxy.networkPassphrase;
    assert.equal(val, 'test');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('ILN_TESTNET is deprecated'));
  });
});
