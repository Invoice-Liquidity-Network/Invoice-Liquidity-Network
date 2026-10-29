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
  it('rejects a signature that is not a valid-length hex digest without comparing it', () => {
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
    });

    const update = store.sign(PAYLOAD, nextNonce());
    // `timingSafeEqual` throws for unequal buffer lengths, so a truncated or
    // non-hex signature has to be rejected before the comparison, not crash it.
    const result = store.verifySignedUpdate({ ...update, signature: 'deadbeef' });

    expect(result).toMatchObject({ valid: false, code: 'invalid_signature' });
  });

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
    // Deterministic single-character flip: mutating every `a` would leave the
    // signature untouched on the rare digest that has none.
    const lastChar = update.signature.endsWith('0') ? '1' : '0';
    const tampered: SignedPriceUpdate = {
      ...update,
      signature: update.signature.slice(0, -1) + lastChar,
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
      previousKeyId: KEY_ID_PREV,
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
      previousKeyId: KEY_ID_PREV,
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

  it('rejects an update carrying the previous key id once the window closes, naming the code', () => {
    let fakeTime = 10_000;
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
      previousKey: KEY_PREV,
      previousKeyId: KEY_ID_PREV,
      rotationWindowMs: 60_000,
      rotationStartedAt: fakeTime,
      now: () => fakeTime,
    });

    fakeTime += 60_001;
    const result = store.verifySignedUpdate({
      payload: PAYLOAD,
      signature: 'ab'.repeat(32),
      keyId: KEY_ID_PREV,
      nonce: nextNonce(),
      issuedAt: Math.floor(fakeTime / 1000),
    });

    expect(result).toMatchObject({ valid: false, code: 'unknown_key' });
  });

  it('rejects a previousKey supplied without its key id', () => {
    expect(
      () =>
        new OracleSigningKeyStore({
          currentKey: KEY_CURRENT,
          currentKeyId: KEY_ID,
          previousKey: KEY_PREV,
        })
    ).toThrow(/previousKeyId is required/);
  });

  it('never trusts the previous key unconditionally when rotation start is omitted', () => {
    let fakeTime = 1_000_000;
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
      previousKey: KEY_PREV,
      previousKeyId: KEY_ID_PREV,
      rotationWindowMs: 1_000,
      now: () => fakeTime,
    });

    const signedByOldKey = new OracleSigningKeyStore({
      currentKey: KEY_PREV,
      currentKeyId: KEY_ID_PREV,
      now: () => fakeTime,
    }).sign(PAYLOAD, nextNonce());

    // The window opened at construction and has since elapsed.
    fakeTime += 2_000;
    expect(store.verifySignedUpdate(signedByOldKey)).toMatchObject({ code: 'unknown_key' });
  });

  // ── Freshness window ──────────────────────────────────────────────────────

  it('rejects a correctly signed update that has gone stale', () => {
    let fakeTime = 1_000_000;
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
      maxAgeMs: 60_000,
      now: () => fakeTime,
    });

    const update = store.sign(PAYLOAD, nextNonce());
    fakeTime += 60_001;

    expect(store.verifySignedUpdate(update)).toMatchObject({ valid: false, code: 'stale_update' });
  });

  it('rejects a captured update once it ages out, rather than re-accepting it', () => {
    // The replay hole this closes: the nonce cache is bounded, so a captured
    // update would become acceptable again once its nonce aged out if
    // acceptance depended on the nonce alone.
    let fakeTime = 1_000_000;
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
      maxAgeMs: 10_000,
      maxFutureSkewMs: 1_000,
      now: () => fakeTime,
    });

    const captured = store.sign(PAYLOAD, nextNonce());

    // Past both the freshness window and the retention the store chose.
    fakeTime += 20_000;
    expect(store.verifySignedUpdate(captured)).toMatchObject({ code: 'stale_update' });
  });

  it('keeps nonces at least as long as an update stays acceptable', () => {
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
      maxAgeMs: 120_000,
      maxFutureSkewMs: 30_000,
      nonceTtlMs: 1,
    });

    const update = store.sign(PAYLOAD, 'retained-nonce');
    expect(store.verifySignedUpdate(update).valid).toBe(true);
    expect(store.verifySignedUpdate(update)).toMatchObject({ code: 'replayed_nonce' });
  });

  it('accepts a small amount of producer clock skew but not a large one', () => {
    const verifierTime = 1_000_000;
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
      maxFutureSkewMs: 5_000,
      now: () => verifierTime,
    });

    // A producer whose clock runs a few seconds ahead of the verifier's.
    const produceWithSkew = (skewMs: number): SignedPriceUpdate =>
      new OracleSigningKeyStore({
        currentKey: KEY_CURRENT,
        currentKeyId: KEY_ID,
        now: () => verifierTime + skewMs,
      }).sign(PAYLOAD, nextNonce());

    expect(store.verifySignedUpdate(produceWithSkew(3_000)).valid).toBe(true);
    expect(store.verifySignedUpdate(produceWithSkew(3_600_000))).toMatchObject({
      code: 'future_update',
    });
  });

  // ── Published rotation state ──────────────────────────────────────────────

  it('publishes which key ids are currently honoured, without exposing secrets', () => {
    let fakeTime = 10_000;
    const store = new OracleSigningKeyStore({
      currentKey: KEY_CURRENT,
      currentKeyId: KEY_ID,
      previousKey: KEY_PREV,
      previousKeyId: KEY_ID_PREV,
      rotationWindowMs: 60_000,
      rotationStartedAt: fakeTime,
      now: () => fakeTime,
    });

    expect(store.getPublicConfig()).toEqual({
      currentKeyId: KEY_ID,
      previousKeyId: KEY_ID_PREV,
      rotationWindowOpen: true,
      rotationExpiresAt: new Date(70_000).toISOString(),
    });

    fakeTime += 60_001;
    expect(store.getPublicConfig()).toEqual({
      currentKeyId: KEY_ID,
      previousKeyId: null,
      rotationWindowOpen: false,
      rotationExpiresAt: null,
    });

    expect(JSON.stringify(store.getPublicConfig())).not.toContain(KEY_CURRENT);
    expect(JSON.stringify(store.getPublicConfig())).not.toContain(KEY_PREV);
  });
});

// ---------------------------------------------------------------------------
// Construction guards
// ---------------------------------------------------------------------------

describe('OracleSigningKeyStore construction', () => {
  it('refuses to build a store with no current key', () => {
    expect(() => new OracleSigningKeyStore({ currentKey: '', currentKeyId: KEY_ID })).toThrow(
      /currentKey is required/
    );
  });

  it('refuses to build a store with no current key id', () => {
    expect(() => new OracleSigningKeyStore({ currentKey: KEY_CURRENT, currentKeyId: '' })).toThrow(
      /currentKeyId is required/
    );
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

  it('refuses to build a store with no signing key', () => {
    expect(() => createSigningKeyStore({ env: {} })).toThrow(/ORACLE_SIGNING_KEY is required/);
  });

  it('labels the previous key from ORACLE_SIGNING_KEY_PREV_ID', () => {
    let fakeTime = 10_000;
    const store = createSigningKeyStore({
      now: () => fakeTime,
      env: {
        ORACLE_SIGNING_KEY: KEY_CURRENT,
        ORACLE_SIGNING_KEY_ID: 'v2',
        ORACLE_SIGNING_KEY_PREV: KEY_PREV,
        ORACLE_SIGNING_KEY_PREV_ID: 'v1',
      },
    });

    expect(store.getPublicConfig().previousKeyId).toBe('v1');

    // An update carrying the retired id is honoured only inside the window.
    fakeTime += 5 * 60 * 1000 + 1;
    expect(store.getPublicConfig().previousKeyId).toBeNull();
  });

  it('treats a rotation start in the past as an expired window', () => {
    const store = createSigningKeyStore({
      now: () => 1_000_000,
      env: {
        ORACLE_SIGNING_KEY: KEY_CURRENT,
        ORACLE_SIGNING_KEY_PREV: KEY_PREV,
        ORACLE_SIGNING_KEY_ROTATION_STARTED_AT: '1',
        ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS: '1000',
      },
    });

    expect(store.getPublicConfig().rotationWindowOpen).toBe(false);
  });

  it('ignores a non-numeric window instead of trusting it', () => {
    const store = createSigningKeyStore({
      env: {
        ORACLE_SIGNING_KEY: KEY_CURRENT,
        ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS: 'soon',
      },
    });

    expect(store.getPublicConfig().rotationWindowOpen).toBe(true);
  });

  it('applies ORACLE_SIGNING_KEY_MAX_AGE_MS to verification', () => {
    let fakeTime = 1_000_000;
    const store = createSigningKeyStore({
      now: () => fakeTime,
      env: {
        ORACLE_SIGNING_KEY: KEY_CURRENT,
        ORACLE_SIGNING_KEY_MAX_AGE_MS: '1000',
      },
    });

    const update = store.sign(PAYLOAD, nextNonce());
    fakeTime += 5_000;

    expect(store.verifySignedUpdate(update)).toMatchObject({ code: 'stale_update' });
  });
});
