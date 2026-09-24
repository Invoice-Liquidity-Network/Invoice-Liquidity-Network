/**
 * oracle-service/src/signer.ts
 *
 * Provides HMAC-SHA256 signing, verification, nonce-based replay protection,
 * and key-rotation support for oracle signed-price updates.
 *
 * Key rotation procedure
 * ──────────────────────
 * 1. Generate a new secret key and set ORACLE_SIGNING_KEY to it.
 * 2. Move the old key to ORACLE_SIGNING_KEY_PREV.
 * 3. Change ORACLE_SIGNING_KEY_ID to a new label (e.g. "v2").
 * 4. Optionally set ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS (default 300 000).
 * 5. Deploy.  During the rotation window, updates signed with either key are
 *    accepted.  After the window, only the current key is trusted.
 * 6. Once all producers have been updated, clear ORACLE_SIGNING_KEY_PREV.
 */

import { createHmac, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A signed price update emitted by an oracle producer and consumed by the
 * verifier.
 */
export interface SignedPriceUpdate {
  /** JSON-serialised payload (opaque to the signing layer). */
  payload: string;
  /** HMAC-SHA256 hex digest of `keyId:nonce:issuedAt:payload`. */
  signature: string;
  /** Identifies which key was used; must match a key held by the store. */
  keyId: string;
  /** Unique per-update identifier used for replay detection. */
  nonce: string;
  /** Unix epoch **seconds** when the update was produced. */
  issuedAt: number;
}

export interface VerifyResult {
  valid: true;
  usedPreviousKey: boolean;
}

export interface VerifyError {
  valid: false;
  reason: string;
}

export type VerifyOutcome = VerifyResult | VerifyError;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Nonces are remembered for this long to detect replays. */
const NONCE_TTL_MS = 5 * 60 * 1000;

interface NonceEntry {
  expiresAt: number;
}

function buildMessage(update: Omit<SignedPriceUpdate, 'signature'>): string {
  return `${update.keyId}:${update.nonce}:${update.issuedAt}:${update.payload}`;
}

function computeHmac(key: string, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// OracleSigningKeyStore
// ---------------------------------------------------------------------------

export interface OracleSigningKeyStoreOptions {
  /** The active signing key (raw string secret). */
  currentKey: string;
  /** The label that identifies the current key (e.g. "v1"). */
  currentKeyId: string;
  /** The previous key, accepted during the rotation window. */
  previousKey?: string;
  /** Duration (ms) during which previousKey is trusted. Default: 5 minutes. */
  rotationWindowMs?: number;
  /**
   * Timestamp (ms epoch) at which the rotation to `currentKey` began.
   * Set to 0 (or omit) to trust previousKey unconditionally while it is set.
   */
  rotationStartedAt?: number;
  /** Injectable clock for deterministic testing. */
  now?: () => number;
}

export class OracleSigningKeyStore {
  private readonly currentKey: string;
  private readonly currentKeyId: string;
  private readonly previousKey: string | undefined;
  private readonly rotationWindowMs: number;
  private readonly rotationStartedAt: number;
  private readonly now: () => number;

  /** nonce → expiry timestamp (ms). Evicted lazily on each verify call. */
  private readonly usedNonces = new Map<string, NonceEntry>();

  constructor(opts: OracleSigningKeyStoreOptions) {
    if (!opts.currentKey) throw new Error('OracleSigningKeyStore: currentKey is required');
    if (!opts.currentKeyId) throw new Error('OracleSigningKeyStore: currentKeyId is required');

    this.currentKey = opts.currentKey;
    this.currentKeyId = opts.currentKeyId;
    this.previousKey = opts.previousKey || undefined;
    this.rotationWindowMs = opts.rotationWindowMs ?? NONCE_TTL_MS;
    this.rotationStartedAt = opts.rotationStartedAt ?? 0;
    this.now = opts.now ?? Date.now;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Sign a payload and return a complete SignedPriceUpdate using the current
   * key.
   */
  sign(payload: string, nonce: string): SignedPriceUpdate {
    const issuedAt = Math.floor(this.now() / 1000);
    const unsigned: Omit<SignedPriceUpdate, 'signature'> = {
      payload,
      keyId: this.currentKeyId,
      nonce,
      issuedAt,
    };
    return { ...unsigned, signature: computeHmac(this.currentKey, buildMessage(unsigned)) };
  }

  /**
   * Verify a SignedPriceUpdate.
   *
   * Performs these checks in order:
   *  1. Resolve the signing key from `keyId` (current key, or previous key
   *     during the rotation window).  Unknown keyIds are rejected.
   *  2. Validate the HMAC signature with timing-safe comparison.
   *  3. Check that the nonce has not been used before (replay protection).
   *
   * On success, the nonce is stored for NONCE_TTL_MS to block replays.
   */
  verifySignedUpdate(update: SignedPriceUpdate): VerifyOutcome {
    this.evictExpiredNonces();

    // ── 1. Key resolution ───────────────────────────────────────────────────
    let candidateKey: string | undefined;
    let usedPreviousKey = false;

    if (update.keyId === this.currentKeyId) {
      candidateKey = this.currentKey;
    } else if (this.previousKey && this.isRotationWindowOpen()) {
      candidateKey = this.previousKey;
      usedPreviousKey = true;
    }

    if (!candidateKey) {
      return { valid: false, reason: `Unknown keyId: ${update.keyId}` };
    }

    // ── 2. Signature check ──────────────────────────────────────────────────
    const unsigned: Omit<SignedPriceUpdate, 'signature'> = {
      payload: update.payload,
      keyId: update.keyId,
      nonce: update.nonce,
      issuedAt: update.issuedAt,
    };
    const expected = computeHmac(candidateKey, buildMessage(unsigned));

    if (!safeEqual(update.signature, expected)) {
      return { valid: false, reason: 'Invalid signature' };
    }

    // ── 3. Replay check ─────────────────────────────────────────────────────
    if (this.usedNonces.has(update.nonce)) {
      return { valid: false, reason: `Replayed nonce: ${update.nonce}` };
    }

    this.usedNonces.set(update.nonce, { expiresAt: this.now() + NONCE_TTL_MS });

    return { valid: true, usedPreviousKey };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private isRotationWindowOpen(): boolean {
    if (!this.rotationStartedAt) {
      // No rotation timestamp recorded — trust previous key unconditionally.
      return true;
    }
    return this.now() - this.rotationStartedAt < this.rotationWindowMs;
  }

  private evictExpiredNonces(): void {
    const now = this.now();
    for (const [nonce, entry] of this.usedNonces) {
      if (entry.expiresAt <= now) {
        this.usedNonces.delete(nonce);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateSigningKeyStoreOptions {
  /** Override process.env for testing. */
  env?: NodeJS.ProcessEnv;
  /** Injectable clock. */
  now?: () => number;
}

/**
 * Build an OracleSigningKeyStore from environment variables:
 *
 *  - `ORACLE_SIGNING_KEY`                  — required; the active signing key
 *  - `ORACLE_SIGNING_KEY_ID`               — optional (default "v1")
 *  - `ORACLE_SIGNING_KEY_PREV`             — optional; trusted during rotation
 *  - `ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS` — optional (default 300 000 ms)
 */
export function createSigningKeyStore(
  opts: CreateSigningKeyStoreOptions = {}
): OracleSigningKeyStore {
  const env = opts.env ?? process.env;

  const currentKey = env.ORACLE_SIGNING_KEY ?? '';
  const currentKeyId = env.ORACLE_SIGNING_KEY_ID ?? 'v1';
  const previousKey = env.ORACLE_SIGNING_KEY_PREV || undefined;
  const rotationWindowMs = env.ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS
    ? Number(env.ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS)
    : NONCE_TTL_MS;

  return new OracleSigningKeyStore({
    currentKey,
    currentKeyId,
    previousKey,
    rotationWindowMs,
    rotationStartedAt: 0,
    now: opts.now,
  });
}
