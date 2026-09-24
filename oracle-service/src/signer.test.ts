import { describe, expect, it } from 'vitest';
import { OracleSigningKeyStore, createSigningKeyStore } from './signer';
import type { SignedPriceUpdate } from './signer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nonce = 0;
function nextNonce(): string {
  _nonce += 1;
  return `nonce-${_nonce}`;
}

const KEY_CURRENT = 'super-secret-current-key';
const KEY_PREV = 'super-secret-previous-key';
const KEY_ID = 'v2';
const KEY_ID_PREV = 'v1';
const PAYLOAD = JSON.stringify({ price: '1.23', asset: 'BTC' });

// ---------------------------------------------------------------------------
// verifySignedUpdate — unknown key id
// ---------------------------------------------------------------------------

describe('OracleSigningKeyStore.verifySignedUpdate', () => {
  it('rejects updates signed with an unknown keyId', () => {
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
    });

    const fakeUpdate: SignedPriceUpdate = {
      payload: PAYLOAD,
      signature: 'deadbeef'.repeat(8),
      keyId: 'unknown-key-id',
      nonce: nextNonce(),
      issuedAt: Math.floor(Date.now() / 1000),
    };

    const result = store.verifySignedUpdate(fakeUpdate);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/Unknown keyId/i);
    }
  });

  // ── Replay protection ────────────────────────────────────────────────────

  it('rejects a replayed nonce', () => {
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
    });

    const nonce = nextNonce();
    const update = store.sign(PAYLOAD, nonce);

    // First verification should succeed.
    const first = store.verifySignedUpdate(update);
    expect(first.valid).toBe(true);

    // Second verification with the same nonce should be rejected.
    const second = store.verifySignedUpdate(update);
    expect(second.valid).toBe(false);
    if (!second.valid) {
      expect(second.reason).toMatch(/Replayed nonce/i);
    }
  });

  it('accepts a fresh nonce after another nonce has expired (TTL eviction)', () => {
    let fakeTime = 0;
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
      now: () => fakeTime,
    });

    fakeTime = 1_000;
    const update1 = store.sign(PAYLOAD, nextNonce());
    const r1 = store.verifySignedUpdate(update1);
    expect(r1.valid).toBe(true);

    // Advance past the 5-minute TTL.
    fakeTime = 1_000 + 5 * 60 * 1000 + 1;

    const update2 = store.sign(PAYLOAD, nextNonce());
    const r2 = store.verifySignedUpdate(update2);
    expect(r2.valid).toBe(true);
  });

  // ── Valid current key ────────────────────────────────────────────────────

  it('accepts a valid update signed with the current key', () => {
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
    });

    const update = store.sign(PAYLOAD, nextNonce());
    expect(update.keyId).toBe(KEY_ID);

    const result = store.verifySignedUpdate(update);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.usedPreviousKey).toBe(false);
    }
  });

  it('rejects an update whose signature has been tampered with', () => {
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
    });

    const update = store.sign(PAYLOAD, nextNonce());
    const tampered: SignedPriceUpdate = {
      ...update,
      signature: update.signature.replace(/a/g, 'b'),
    };

    const result = store.verifySignedUpdate(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/Invalid signature/i);
    }
  });

  // ── Previous key during rotation window ─────────────────────────────────

  it('accepts a valid update signed with the previous key during the rotation window', () => {
    let fakeTime = 10_000;
    const rotationWindowMs = 60_000;

    // Producer still using the old key.
    const oldStore = new OracleSigningKeyStore({
      currentKey: KEY_PREV,
      currentKeyId: KEY_ID_PREV,
      now: () => fakeTime,
    });

    // Verifier knows both keys.
    const verifierStore = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
      previousKey: KEY_PREV,
      rotationWindowMs,
      rotationStartedAt: fakeTime,
      now: () => fakeTime,
    });

    const update = oldStore.sign(PAYLOAD, nextNonce());
    // update.keyId === KEY_ID_PREV (old key)

    const result = verifierStore.verifySignedUpdate(update);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.usedPreviousKey).toBe(true);
    }
  });

  it('rejects a previous-key update after the rotation window has elapsed', () => {
    let fakeTime = 10_000;
    const rotationWindowMs = 60_000;

    const oldStore = new OracleSigningKeyStore({
      currentKey: KEY_PREV,
      currentKeyId: KEY_ID_PREV,
      now: () => fakeTime,
    });

    const verifierStore = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
      previousKey: KEY_PREV,
      rotationWindowMs,
      rotationStartedAt: fakeTime,
      now: () => fakeTime,
    });

    // Sign while still inside window.
    const update = oldStore.sign(PAYLOAD, nextNonce());

    // Advance past the rotation window.
    fakeTime += rotationWindowMs + 1;

    const result = verifierStore.verifySignedUpdate(update);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/Unknown keyId/i);
    }
  });
});

// ---------------------------------------------------------------------------
// createSigningKeyStore
// ---------------------------------------------------------------------------

describe('createSigningKeyStore', () => {
  it('reads configuration from env vars', () => {
    const store = createSigningKeyStore({
      env: {
        ORACLE_SIGNING_KEY: 'env-key',
        ORACLE_SIGNING_KEY_ID: 'env-v1',
      },
    });

    const update = store.sign('hello', nextNonce());
    expect(update.keyId).toBe('env-v1');

    const result = store.verifySignedUpdate(update);
    expect(result.valid).toBe(true);
  });

  it('defaults keyId to "v1" when ORACLE_SIGNING_KEY_ID is not set', () => {
    const store = createSigningKeyStore({
      env: { ORACLE_SIGNING_KEY: 'some-key' },
    });
    const update = store.sign('payload', nextNonce());
    expect(update.keyId).toBe('v1');
  });
});
