/**
 * Notification address ownership verification (#1281)
 *
 * A subscription routes invoice details for a Stellar address to an email,
 * webhook or phone number. Without proof that the subscriber controls that
 * address, anyone could subscribe to another account's invoice activity.
 *
 * Flow:
 *   1. POST /subscribe/challenge  → server stores a single-use nonce and
 *      returns the exact message to sign.
 *   2. The subscriber signs the message with the ed25519 key behind the
 *      Stellar address and submits the base64 signature with the nonce.
 *   3. verifyOwnershipProof() checks the signature, expiry and single use,
 *      atomically consuming the challenge on success.
 *
 * The processor only delivers to subscriptions with `ownership_verified_at`
 * set, so rows created before this control (NULL) fail closed until the
 * owner re-verifies via POST /subscriptions/verify.
 */

import { randomBytes } from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { getDb, countUnverifiedSubscriptions } from './db';
import { CONFIG } from './config';

export type OwnershipRejectionReason =
  | 'invalid_address'
  | 'missing_proof'
  | 'unknown_challenge'
  | 'address_mismatch'
  | 'expired'
  | 'replayed'
  | 'invalid_signature';

export interface OwnershipChallenge {
  nonce: string;
  message: string;
  expires_at: number;
}

export type OwnershipVerificationResult =
  | { ok: true; verifiedAt: number }
  | { ok: false; reason: OwnershipRejectionReason };

export interface OwnershipProof {
  stellarAddress: unknown;
  nonce: unknown;
  signature: unknown;
}

interface ChallengeRow {
  nonce: string;
  stellar_address: string;
  message: string;
  expires_at: number;
  consumed_at: number | null;
}

// ── Metrics ────────────────────────────────────────────────────────────────

const counters = {
  challengesIssued: 0,
  verified: 0,
  rejected: {} as Partial<Record<OwnershipRejectionReason, number>>,
  deliveriesBlockedUnverified: 0,
  digestsBlockedNoVerifiedEmail: 0,
};

function recordRejection(stellarAddress: string, reason: OwnershipRejectionReason): void {
  counters.rejected[reason] = (counters.rejected[reason] ?? 0) + 1;
  console.warn(`[ownership] verification rejected ${JSON.stringify({ stellarAddress, reason })}`);
}

export function recordBlockedDelivery(
  kind: 'unverified_subscription' | 'digest_without_verified_email',
  stellarAddress: string,
  destination?: string
): void {
  if (kind === 'unverified_subscription') {
    counters.deliveriesBlockedUnverified += 1;
  } else {
    counters.digestsBlockedNoVerifiedEmail += 1;
  }
  console.warn(
    `[ownership] delivery blocked ${JSON.stringify({ kind, stellarAddress, destination })}`
  );
}

/**
 * Snapshot of the control's counters. In-memory counters reset on restart;
 * `unverifiedSubscriptions` is read from SQLite so it survives restarts.
 */
export function getOwnershipMetrics() {
  return {
    control: 'notification-address-ownership-verification',
    challengesIssued: counters.challengesIssued,
    verified: counters.verified,
    rejected: { ...counters.rejected },
    deliveriesBlockedUnverified: counters.deliveriesBlockedUnverified,
    digestsBlockedNoVerifiedEmail: counters.digestsBlockedNoVerifiedEmail,
    unverifiedSubscriptions: countUnverifiedSubscriptions(),
  };
}

export function resetOwnershipMetrics(): void {
  counters.challengesIssued = 0;
  counters.verified = 0;
  counters.rejected = {};
  counters.deliveriesBlockedUnverified = 0;
  counters.digestsBlockedNoVerifiedEmail = 0;
}

// ── Challenge / verification ───────────────────────────────────────────────

/** True once the subscription's owner has signed an ownership challenge. */
export function isOwnershipVerified(subscription: {
  ownership_verified_at?: number | null;
}): boolean {
  return typeof subscription.ownership_verified_at === 'number';
}

export function isValidStellarAddress(address: unknown): address is string {
  return typeof address === 'string' && StrKey.isValidEd25519PublicKey(address);
}

export function buildOwnershipMessage(address: string, nonce: string, expiresAt: number): string {
  return [
    'ILN notifications: prove ownership of this Stellar address',
    `address: ${address}`,
    `nonce: ${nonce}`,
    `expires: ${new Date(expiresAt).toISOString()}`,
  ].join('\n');
}

export function issueOwnershipChallenge(
  stellarAddress: string,
  nowMs = Date.now()
): OwnershipChallenge {
  if (!isValidStellarAddress(stellarAddress)) {
    throw new Error('stellar_address must be a valid Stellar public key (G...)');
  }

  const nonce = randomBytes(24).toString('hex');
  const expiresAt = nowMs + CONFIG.ownershipChallengeTtlMs;
  const message = buildOwnershipMessage(stellarAddress, nonce, expiresAt);

  getDb()
    .prepare(
      `INSERT INTO ownership_challenges
         (nonce, stellar_address, message, expires_at, consumed_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    )
    .run(nonce, stellarAddress, message, expiresAt, nowMs);

  counters.challengesIssued += 1;
  return { nonce, message, expires_at: expiresAt };
}

/**
 * Verify a signed ownership challenge. A challenge is valid strictly before
 * `expires_at` and can be consumed exactly once. Database errors propagate so
 * callers fail closed instead of treating an unreadable challenge as valid.
 */
export function verifyOwnershipProof(
  proof: OwnershipProof,
  nowMs = Date.now()
): OwnershipVerificationResult {
  const { stellarAddress, nonce, signature } = proof;
  const label = typeof stellarAddress === 'string' ? stellarAddress : '<invalid>';

  const reject = (reason: OwnershipRejectionReason): OwnershipVerificationResult => {
    recordRejection(label, reason);
    return { ok: false, reason };
  };

  if (!isValidStellarAddress(stellarAddress)) return reject('invalid_address');
  if (typeof nonce !== 'string' || typeof signature !== 'string' || !nonce || !signature) {
    return reject('missing_proof');
  }

  const row = getDb()
    .prepare(
      `SELECT nonce, stellar_address, message, expires_at, consumed_at
       FROM ownership_challenges WHERE nonce = ?`
    )
    .get(nonce) as ChallengeRow | undefined;

  if (!row) return reject('unknown_challenge');
  if (row.stellar_address !== stellarAddress) return reject('address_mismatch');
  if (row.consumed_at !== null) return reject('replayed');
  if (nowMs >= row.expires_at) return reject('expired');

  let valid = false;
  try {
    valid = Keypair.fromPublicKey(stellarAddress).verify(
      Buffer.from(row.message, 'utf8'),
      Buffer.from(signature, 'base64')
    );
  } catch {
    valid = false;
  }
  if (!valid) return reject('invalid_signature');

  // Conditional update closes the race between two concurrent submissions of
  // the same proof: only one sees changes === 1.
  const consumed = getDb()
    .prepare(
      'UPDATE ownership_challenges SET consumed_at = ? WHERE nonce = ? AND consumed_at IS NULL'
    )
    .run(nowMs, nonce);
  if (consumed.changes !== 1) return reject('replayed');

  counters.verified += 1;
  return { ok: true, verifiedAt: nowMs };
}
