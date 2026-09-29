/**
 * oracle-service/src/signer.ts
 *
 * Provides HMAC-SHA256 signing, verification, nonce-based replay protection,
 * and key-rotation support for oracle signed-price updates.
 *
 * Replay protection
 * ─────────────────
 * A signed update is only accepted when all three hold:
 *  1. its `keyId` maps to a key the store trusts right now;
 *  2. its HMAC matches, compared in constant time;
 *  3. its `issuedAt` is inside the freshness window, and its `nonce` has not
 *     been seen before.
 *
 * The two time-based checks are what make the nonce cache sound. A nonce is
 * only remembered for `nonceTtlMs`, so a replay is only guaranteed to be
 * caught while the original would still be accepted. The store therefore
 * forces `nonceTtlMs >= maxAgeMs + maxFutureSkewMs`: once an update is too
 * old (or too far in the future) to be honoured at all, forgetting its nonce
 * is safe; while it is still live, the nonce is retained.
 *
 * Key rotation procedure
 * ──────────────────────
 * 1. Generate a new secret and set it as `ORACLE_SIGNING_KEY`.
 * 2. Move the old secret to `ORACLE_SIGNING_KEY_PREV` and set
 *    `ORACLE_SIGNING_KEY_PREV_ID` to the id that old key was published under.
 * 3. Set `ORACLE_SIGNING_KEY_ID` to the new label (e.g. "v2").
 * 4. Optionally set `ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS` (default 300 000)
 *    and `ORACLE_SIGNING_KEY_ROTATION_STARTED_AT` (ms epoch). When the start
 *    is omitted it defaults to the moment the store is built, so a deployment
 *    that restarts after the window has passed has already stopped trusting
 *    the previous key.
 * 5. Deploy. During the window both keys are honoured; after it the previous
 *    key is rejected, so there is no indefinite dual-trust period even if
 *    `ORACLE_SIGNING_KEY_PREV` is left set by accident.
 * 6. Once every producer has moved to the new key, clear
 *    `ORACLE_SIGNING_KEY_PREV` and `ORACLE_SIGNING_KEY_PREV_ID`.
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

/** Machine-readable rejection codes, so callers can branch without string matching. */
export type VerifyRejectCode =
  | 'unknown_key'
  | 'invalid_signature'
  | 'replayed_nonce'
  | 'stale_update'
  | 'future_update';

export interface VerifyError {
  valid: false;
  reason: string;
  code: VerifyRejectCode;
}

export type VerifyOutcome = VerifyResult | VerifyError;

/** Non-secret rotation state published by `getPublicConfig()`. */
export interface OracleSigningPublicConfig {
  currentKeyId: string;
  /** The previous key id, or null once its rotation window has closed. */
  previousKeyId: string | null;
  rotationWindowOpen: boolean;
  /** ISO timestamp after which only `currentKeyId` is honoured. */
  rotationExpiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** How long a nonce is remembered when no freshness window forces it longer. */
const DEFAULT_NONCE_TTL_MS = 5 * 60 * 1000;

/** Accepted distance between `issuedAt` and now before an update is stale. */
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/** Tolerance for a producer clock running slightly ahead of ours. */
const DEFAULT_MAX_FUTURE_SKEW_MS = 5_000;

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
  /**
   * The label the previous key was published under. Required whenever
   * `previousKey` is set: without it a verifier could not tell an old-but-legit
   * key id from an entirely unknown one, and any unknown `keyId` would be
   * accepted for as long as the rotation window stayed open.
   */
  previousKeyId?: string;
  /** Duration (ms) during which previousKey is trusted. Default: 5 minutes. */
  rotationWindowMs?: number;
  /**
   * Timestamp (ms epoch) at which the rotation to `currentKey` began.
   * Defaults to the moment the store is constructed, so trust in the previous
   * key always expires.
   */
  rotationStartedAt?: number;
  /** Maximum accepted age of an update, in ms of `issuedAt` skew behind now. */
  maxAgeMs?: number;
  /** Accepted amount by which a producer clock may run ahead of ours, in ms. */
  maxFutureSkewMs?: number;
  /**
   * How long a seen nonce is retained. Raised automatically to cover the full
   * freshness window, since a nonce forgotten while its update could still be
   * replayed would leave a replay hole.
   */
  nonceTtlMs?: number;
  /** Injectable clock for deterministic testing. */
  now?: () => number;
}

export class OracleSigningKeyStore {
  private readonly currentKey: string;
  private readonly currentKeyId: string;
  private readonly previousKey: string | undefined;
  private readonly previousKeyId: string | undefined;
  private readonly rotationWindowMs: number;
  private readonly rotationStartedAt: number;
  private readonly maxAgeMs: number;
  private readonly maxFutureSkewMs: number;
  private readonly nonceTtlMs: number;
  private readonly now: () => number;

  /** nonce → expiry timestamp (ms). Evicted lazily on each verify call. */
  private readonly usedNonces = new Map<string, NonceEntry>();

  constructor(opts: OracleSigningKeyStoreOptions) {
    if (!opts.currentKey) throw new Error('OracleSigningKeyStore: currentKey is required');
    if (!opts.currentKeyId) throw new Error('OracleSigningKeyStore: currentKeyId is required');
    if (opts.previousKey && !opts.previousKeyId) {
      throw new Error('OracleSigningKeyStore: previousKeyId is required when previousKey is set');
    }

    this.currentKey = opts.currentKey;
    this.currentKeyId = opts.currentKeyId;
    this.previousKey = opts.previousKey || undefined;
    this.previousKeyId = opts.previousKeyId || undefined;
    this.rotationWindowMs = opts.rotationWindowMs ?? DEFAULT_NONCE_TTL_MS;
    this.rotationStartedAt = opts.rotationStartedAt ?? (opts.now ?? Date.now)();
    this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.maxFutureSkewMs = opts.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS;
    // A nonce must outlive the window in which its update is still acceptable.
    this.nonceTtlMs = Math.max(
      opts.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS,
      this.maxAgeMs + this.maxFutureSkewMs
    );
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
   * Public rotation state (#1053).
   *
   * Rotation cannot be zero-downtime if every verifier has to be reconfigured in
   * lockstep with the signer, so the service advertises which key ids it
   * currently honours and when trust in the previous key lapses. Secrets never
   * appear here — only labels and timing.
   */
  getPublicConfig(): OracleSigningPublicConfig {
    const windowOpen = this.isRotationWindowOpen();
    return {
      currentKeyId: this.currentKeyId,
      previousKeyId: this.previousKeyId && windowOpen ? this.previousKeyId : null,
      rotationWindowOpen: windowOpen,
      rotationExpiresAt:
        this.previousKey && windowOpen
          ? new Date(this.rotationStartedAt + this.rotationWindowMs).toISOString()
          : null,
    };
  }

  /**
   * Verify a SignedPriceUpdate.
   *
   * Performs these checks in order:
   *  1. Resolve the signing key from `keyId` — the current key, or the previous
   *     key only when its own id matches and the rotation window is still open.
   *     Every other keyId is rejected.
   *  2. Validate the HMAC signature with timing-safe comparison.
   *  3. Check `issuedAt` against the freshness window, in both directions.
   *  4. Check that the nonce has not been used before (replay protection).
   *
   * On success, the nonce is stored for at least the freshness window so the
   * same update cannot be accepted twice while it is still live.
   */
  verifySignedUpdate(update: SignedPriceUpdate): VerifyOutcome {
    this.evictExpiredNonces();

    // ── 1. Key resolution ───────────────────────────────────────────────────
    let candidateKey: string | undefined;
    let usedPreviousKey = false;

    if (update.keyId === this.currentKeyId) {
      candidateKey = this.currentKey;
    } else if (
      this.previousKey &&
      this.previousKeyId === update.keyId &&
      this.isRotationWindowOpen()
    ) {
      candidateKey = this.previousKey;
      usedPreviousKey = true;
    }

    if (!candidateKey) {
      return { valid: false, reason: `Unknown keyId: ${update.keyId}`, code: 'unknown_key' };
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
      return { valid: false, reason: 'Invalid signature', code: 'invalid_signature' };
    }

    // ── 3. Freshness check ──────────────────────────────────────────────────
    // Without this, evicting an expired nonce would reopen a replay hole: an
    // attacker could re-send a captured update indefinitely.
    const ageMs = this.now() - update.issuedAt * 1000;
    if (ageMs > this.maxAgeMs) {
      return {
        valid: false,
        reason: `Update is ${Math.round(ageMs)}ms old, beyond the ${this.maxAgeMs}ms window`,
        code: 'stale_update',
      };
    }
    if (-ageMs > this.maxFutureSkewMs) {
      return {
        valid: false,
        reason: `Update is dated ${Math.round(-ageMs)}ms in the future`,
        code: 'future_update',
      };
    }

    // ── 4. Replay check ─────────────────────────────────────────────────────
    if (this.usedNonces.has(update.nonce)) {
      return { valid: false, reason: `Replayed nonce: ${update.nonce}`, code: 'replayed_nonce' };
    }

    this.usedNonces.set(update.nonce, { expiresAt: this.now() + this.nonceTtlMs });

    return { valid: true, usedPreviousKey };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private isRotationWindowOpen(): boolean {
    // rotationStartedAt always defaults to construction time, so the window is
    // bounded. An explicit 0 is treated as "started in the past", i.e. closed —
    // never as unconditional dual trust.
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
 *  - `ORACLE_SIGNING_KEY`                    — required; the active signing key
 *  - `ORACLE_SIGNING_KEY_ID`                 — optional (default "v1")
 *  - `ORACLE_SIGNING_KEY_PREV`               — optional; trusted during rotation
 *  - `ORACLE_SIGNING_KEY_PREV_ID`            — required with PREV (default "v1")
 *  - `ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS`  — optional (default 300 000 ms)
 *  - `ORACLE_SIGNING_KEY_ROTATION_STARTED_AT` — optional ms epoch; defaults to
 *    the moment this factory runs
 *  - `ORACLE_SIGNING_KEY_MAX_AGE_MS`          — optional freshness window
 *
 * @throws when `ORACLE_SIGNING_KEY` is absent — a service must never start with
 *         an unsigned (or silently unsigned) publishing path.
 */
export function createSigningKeyStore(
  opts: CreateSigningKeyStoreOptions = {}
): OracleSigningKeyStore {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;

  const currentKey = env.ORACLE_SIGNING_KEY ?? '';
  if (!currentKey) {
    throw new Error('createSigningKeyStore: ORACLE_SIGNING_KEY is required to sign oracle updates');
  }

  const currentKeyId = env.ORACLE_SIGNING_KEY_ID ?? 'v1';
  const previousKey = env.ORACLE_SIGNING_KEY_PREV || undefined;
  const previousKeyId = env.ORACLE_SIGNING_KEY_PREV_ID || (previousKey ? 'v1' : undefined);
  const rotationWindowMs = parsePositiveInt(
    env.ORACLE_SIGNING_KEY_ROTATION_WINDOW_MS,
    DEFAULT_NONCE_TTL_MS
  );
  // Defaults to "now" so the dual-trust window is always finite.
  const rotationStartedAt = parsePositiveInt(env.ORACLE_SIGNING_KEY_ROTATION_STARTED_AT, now());
  const maxAgeMs = parsePositiveInt(env.ORACLE_SIGNING_KEY_MAX_AGE_MS, DEFAULT_MAX_AGE_MS);

  return new OracleSigningKeyStore({
    currentKey,
    currentKeyId,
    previousKey,
    previousKeyId,
    rotationWindowMs,
    rotationStartedAt,
    maxAgeMs,
    now,
  });
}

/** Parse an env var into a positive integer, falling back when unset or invalid. */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
