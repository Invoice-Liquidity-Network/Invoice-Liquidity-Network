/**
 * Notification address ownership verification (#1281, #1468)
 *
 * A subscription routes invoice details for a Stellar address to an email,
 * webhook or phone number. Without proof that the subscriber controls that
 * address, anyone could subscribe to another account's invoice activity.
 *
 * Recipient Ownership Verification Audit (#1468):
 * ─────────────────────────────────────────────────────────────────────────────
 * • Source of Truth:
 *   - Cryptographic ed25519 signature verified with Stellar public key against
 *     single-use challenge stored in SQLite `ownership_challenges`.
 *   - Delivery gating checks `subscriptions.ownership_verified_at` (populated
 *     atomically upon challenge consumption).
 *
 * • Sensitive Content Policy:
 *   - All invoice lifecycle events (financial amounts, invoice statuses, counterparties),
 *     governance actions (disputes, arbitration), and wallet-sensitive operations
 *     (payouts, addresses) REQUIRE verified recipient ownership.
 *   - Deliveries to unverified subscriptions fail closed with explicit audit logging
 *     and metrics recording.
 *
 * • Operational & Failure Modes:
 *   - Normal: Verified subscriber signs challenge; `ownership_verified_at` recorded;
 *     sensitive notifications delivered.
 *   - Failed: Missing proof, invalid signature, or address mismatch rejected with
 *     explicit reason; delivery blocked; counters incremented.
 *   - Repeated: Challenges are strictly single-use (`consumed_at` conditional update).
 *     Replay bursts fail with reason 'replayed'.
 *   - Stale: Challenges expire strictly after `CONFIG.ownershipChallengeTtlMs`
 *     (rejected with 'expired'). Legacy unverified subscriptions remain NULL.
 *   - Interrupted: DB failures propagate and fail closed; in-flight process crash
 *     aborts verification without granting access.
 *
 * • Residual Risk & Maintainer Decisions:
 *   - On-chain key rotation: If ed25519 account key rotates on chain, existing
 *     verified timestamps remain until explicit revocation or re-verification.
 *   - Off-chain delivery endpoints: Ownership verifies control of Stellar address,
 *     not third-party destination (email/webhook/sms) security.
 *   - Maintainer Decision: Subscriptions created prior to #1281 remain unverified
 *     until the owner explicitly signs via `POST /subscriptions/verify`.
 */

import { randomBytes } from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { getDb, countUnverifiedSubscriptions } from './db';
import { CONFIG } from './config';
import type { NotificationTrigger } from './types';

export type SensitiveContentCategory = 'invoice' | 'governance' | 'wallet';

export const SENSITIVE_CONTENT_TRIGGERS: Record<NotificationTrigger, SensitiveContentCategory> = {
  invoice_submitted: 'invoice',
  invoice_funded: 'invoice',
  invoice_paid: 'invoice',
  payment_received: 'invoice',
  invoice_defaulted: 'invoice',
  invoice_due_soon: 'invoice',
  invoice_overdue: 'invoice',
  dispute_opened: 'governance',
};

export const SENSITIVE_CATEGORIES: ReadonlySet<SensitiveContentCategory> = new Set([
  'invoice',
  'governance',
  'wallet',
]);

/** Returns true if the trigger or content category involves sensitive invoice, governance, or wallet data. */
export function isContentSensitive(triggerOrCategory: string): boolean {
  if (triggerOrCategory in SENSITIVE_CONTENT_TRIGGERS) return true;
  if (SENSITIVE_CATEGORIES.has(triggerOrCategory as SensitiveContentCategory)) return true;
  const lower = triggerOrCategory.toLowerCase();
  return (
    lower.startsWith('invoice') ||
    lower.startsWith('payment') ||
    lower.includes('governance') ||
    lower.includes('wallet') ||
    lower.includes('dispute') ||
    lower.includes('payout') ||
    lower.includes('arbitration')
  );
}

export interface RecipientOwnershipCheckResult {
  allowed: boolean;
  reason?: OwnershipRejectionReason | 'unverified_recipient' | 'missing_recipient';
  verifiedAt?: number;
}

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

/**
 * Verifies that the recipient subscription has proved ownership of their Stellar address
 * before sensitive content (invoice, governance, or wallet data) can be delivered (#1468).
 * Non-sensitive content may pass through, while sensitive content fails closed if unverified.
 */
export function verifyRecipientOwnership(
  subscription: {
    ownership_verified_at?: number | null;
    stellar_address?: string;
    address?: string;
  } | null | undefined,
  triggerOrCategory?: string
): RecipientOwnershipCheckResult {
  if (!subscription) {
    return { allowed: false, reason: 'missing_recipient' };
  }

  const address = subscription.stellar_address ?? subscription.address ?? '';
  if (!isValidStellarAddress(address)) {
    recordRejection(address || '<unknown>', 'invalid_address');
    return { allowed: false, reason: 'invalid_address' };
  }

  // If a specific trigger or category is specified and is NOT sensitive, permit delivery
  if (triggerOrCategory && !isContentSensitive(triggerOrCategory)) {
    return { allowed: true };
  }

  // Sensitive content requires verified ownership
  if (!isOwnershipVerified(subscription)) {
    recordBlockedDelivery('unverified_subscription', address);
    return { allowed: false, reason: 'unverified_recipient' };
  }

  return { allowed: true, verifiedAt: subscription.ownership_verified_at! };
}

/**
 * Asserts that the recipient subscription has proved ownership before sensitive dispatch.
 * Throws an explicit error if ownership verification fails.
 */
export function assertRecipientOwnership(
  subscription: {
    ownership_verified_at?: number | null;
    stellar_address?: string;
    address?: string;
  } | null | undefined,
  triggerOrCategory?: string
): void {
  const result = verifyRecipientOwnership(subscription, triggerOrCategory);
  if (!result.allowed) {
    const address = subscription?.stellar_address ?? subscription?.address ?? '<unknown>';
    throw new Error(
      `[ownership] Recipient ownership verification failed for ${address}: ${result.reason}`
    );
  }
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
