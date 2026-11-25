import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Keypair } from '@stellar/stellar-sdk';
import { createDb, setDb } from '../src/db';
import { CONFIG } from '../src/config';
import {
  assertRecipientOwnership,
  getOwnershipMetrics,
  isContentSensitive,
  isOwnershipVerified,
  issueOwnershipChallenge,
  resetOwnershipMetrics,
  verifyOwnershipProof,
  verifyRecipientOwnership,
  SENSITIVE_CONTENT_TRIGGERS,
  SENSITIVE_CATEGORIES,
} from '../src/ownership';

let db: InstanceType<typeof Database>;
let owner: Keypair;
let attacker: Keypair;

function sign(keypair: Keypair, message: string): string {
  return keypair.sign(Buffer.from(message, 'utf8')).toString('base64');
}

beforeEach(() => {
  db = createDb(':memory:');
  setDb(db);
  owner = Keypair.random();
  attacker = Keypair.random();
  resetOwnershipMetrics();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('Recipient Ownership Verification (#1468)', () => {
  describe('Sensitive content classification', () => {
    it('classifies all invoice lifecycle triggers as sensitive', () => {
      const invoiceTriggers = [
        'invoice_submitted',
        'invoice_funded',
        'invoice_paid',
        'payment_received',
        'invoice_defaulted',
        'invoice_due_soon',
        'invoice_overdue',
      ];
      for (const trigger of invoiceTriggers) {
        expect(isContentSensitive(trigger)).toBe(true);
        expect(SENSITIVE_CONTENT_TRIGGERS[trigger as keyof typeof SENSITIVE_CONTENT_TRIGGERS]).toBe('invoice');
      }
    });

    it('classifies governance dispute triggers as sensitive', () => {
      expect(isContentSensitive('dispute_opened')).toBe(true);
      expect(SENSITIVE_CONTENT_TRIGGERS.dispute_opened).toBe('governance');
      expect(isContentSensitive('governance_proposal_created')).toBe(true);
      expect(isContentSensitive('arbitration_ruling')).toBe(true);
    });

    it('classifies wallet-sensitive triggers and categories as sensitive', () => {
      expect(isContentSensitive('wallet')).toBe(true);
      expect(isContentSensitive('wallet_payout_processed')).toBe(true);
      expect(isContentSensitive('payout_destination_changed')).toBe(true);
      expect(SENSITIVE_CATEGORIES.has('wallet')).toBe(true);
      expect(SENSITIVE_CATEGORIES.has('invoice')).toBe(true);
      expect(SENSITIVE_CATEGORIES.has('governance')).toBe(true);
    });

    it('permits non-sensitive general content without sensitive flag', () => {
      expect(isContentSensitive('system_announcement')).toBe(false);
      expect(isContentSensitive('marketing_newsletter')).toBe(false);
      expect(isContentSensitive('health_check_ping')).toBe(false);
    });
  });

  describe('verifyRecipientOwnership (normal & failure paths)', () => {
    it('normal: allows delivery to a verified subscription for sensitive invoice content', () => {
      const now = Date.now();
      const sub = {
        stellar_address: owner.publicKey(),
        ownership_verified_at: now - 5000,
      };

      const result = verifyRecipientOwnership(sub, 'invoice_funded');
      expect(result.allowed).toBe(true);
      expect(result.verifiedAt).toBe(now - 5000);
      expect(result.reason).toBeUndefined();

      expect(() => assertRecipientOwnership(sub, 'invoice_funded')).not.toThrow();
    });

    it('failed: rejects delivery to an unverified subscription for sensitive content', () => {
      const sub = {
        stellar_address: owner.publicKey(),
        ownership_verified_at: null,
      };

      const result = verifyRecipientOwnership(sub, 'invoice_paid');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('unverified_recipient');

      expect(() => assertRecipientOwnership(sub, 'invoice_paid')).toThrow(
        /Recipient ownership verification failed.*unverified_recipient/
      );

      const metrics = getOwnershipMetrics();
      expect(metrics.deliveriesBlockedUnverified).toBe(2);
    });

    it('failed: rejects delivery if subscription has an invalid Stellar public key', () => {
      const sub = {
        stellar_address: 'GNOT_A_VALID_KEY',
        ownership_verified_at: Date.now(),
      };

      const result = verifyRecipientOwnership(sub, 'invoice_defaulted');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('invalid_address');

      expect(() => assertRecipientOwnership(sub, 'invoice_defaulted')).toThrow(
        /invalid_address/
      );
    });

    it('failed: rejects delivery if subscription is missing or undefined', () => {
      const result = verifyRecipientOwnership(null, 'invoice_overdue');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('missing_recipient');

      expect(() => assertRecipientOwnership(undefined, 'invoice_overdue')).toThrow(
        /missing_recipient/
      );
    });

    it('normal (non-sensitive): allows unverified recipient for non-sensitive announcements', () => {
      const sub = {
        stellar_address: owner.publicKey(),
        ownership_verified_at: null,
      };

      const result = verifyRecipientOwnership(sub, 'system_announcement');
      expect(result.allowed).toBe(true);
      expect(() => assertRecipientOwnership(sub, 'system_announcement')).not.toThrow();
    });
  });

  describe('Cryptographic Proof Verification & Adversarial Cases', () => {
    it('normal: accepts valid ed25519 signature and atomically sets verified state', () => {
      const now = 1_700_000_000_000;
      const challenge = issueOwnershipChallenge(owner.publicKey(), now);
      const proof = {
        stellarAddress: owner.publicKey(),
        nonce: challenge.nonce,
        signature: sign(owner, challenge.message),
      };

      const verification = verifyOwnershipProof(proof, now + 50);
      expect(verification).toEqual({ ok: true, verifiedAt: now + 50 });

      // Subscription check now succeeds
      const sub = {
        stellar_address: owner.publicKey(),
        ownership_verified_at: verification.ok ? verification.verifiedAt : null,
      };
      expect(isOwnershipVerified(sub)).toBe(true);
      expect(verifyRecipientOwnership(sub, 'payment_received').allowed).toBe(true);
    });

    it('repeated: rejects replayed ownership proof submission', () => {
      const now = 1_700_000_000_000;
      const challenge = issueOwnershipChallenge(owner.publicKey(), now);
      const proof = {
        stellarAddress: owner.publicKey(),
        nonce: challenge.nonce,
        signature: sign(owner, challenge.message),
      };

      expect(verifyOwnershipProof(proof, now + 10).ok).toBe(true);
      const replayResult = verifyOwnershipProof(proof, now + 20);
      expect(replayResult).toEqual({ ok: false, reason: 'replayed' });
    });

    it('stale: rejects challenge submission past expiry TTL', () => {
      const now = 1_700_000_000_000;
      const challenge = issueOwnershipChallenge(owner.publicKey(), now);
      const proof = {
        stellarAddress: owner.publicKey(),
        nonce: challenge.nonce,
        signature: sign(owner, challenge.message),
      };

      const expiredTime = now + CONFIG.ownershipChallengeTtlMs + 1;
      const result = verifyOwnershipProof(proof, expiredTime);
      expect(result).toEqual({ ok: false, reason: 'expired' });
    });

    it('adversarial: rejects signature from attacker keypair attempting to claim victim address', () => {
      const now = 1_700_000_000_000;
      const challenge = issueOwnershipChallenge(owner.publicKey(), now);
      const attackerProof = {
        stellarAddress: owner.publicKey(), // victim address
        nonce: challenge.nonce,
        signature: sign(attacker, challenge.message), // attacker's signature
      };

      const result = verifyOwnershipProof(attackerProof, now + 10);
      expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
    });

    it('adversarial: rejects challenge when address in proof does not match challenge address', () => {
      const now = 1_700_000_000_000;
      const challenge = issueOwnershipChallenge(owner.publicKey(), now);
      const mismatchedProof = {
        stellarAddress: attacker.publicKey(), // different address than issued
        nonce: challenge.nonce,
        signature: sign(attacker, challenge.message),
      };

      const result = verifyOwnershipProof(mismatchedProof, now + 10);
      expect(result).toEqual({ ok: false, reason: 'address_mismatch' });
    });

    it('interrupted: propagates database errors and fails closed', () => {
      const challenge = issueOwnershipChallenge(owner.publicKey(), 0);
      db.close();

      expect(() =>
        verifyOwnershipProof(
          {
            stellarAddress: owner.publicKey(),
            nonce: challenge.nonce,
            signature: sign(owner, challenge.message),
          },
          1
        )
      ).toThrow();
    });
  });
});
