import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { Keypair } from '@stellar/stellar-sdk';
import { createDb, setDb } from '../db';
import { CONFIG } from '../config';
import {
  getOwnershipMetrics,
  issueOwnershipChallenge,
  resetOwnershipMetrics,
  verifyOwnershipProof,
} from '../ownership';

let db: InstanceType<typeof Database>;
let owner: Keypair;

function sign(keypair: Keypair, message: string): string {
  return keypair.sign(Buffer.from(message, 'utf8')).toString('base64');
}

beforeEach(() => {
  db = createDb(':memory:');
  setDb(db);
  owner = Keypair.random();
  resetOwnershipMetrics();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ownership challenges (#1281)', () => {
  it('accepts a valid signature exactly once', () => {
    const now = 1_700_000_000_000;
    const challenge = issueOwnershipChallenge(owner.publicKey(), now);
    const proof = {
      stellarAddress: owner.publicKey(),
      nonce: challenge.nonce,
      signature: sign(owner, challenge.message),
    };

    expect(verifyOwnershipProof(proof, now + 1)).toEqual({ ok: true, verifiedAt: now + 1 });
    expect(verifyOwnershipProof(proof, now + 2)).toEqual({ ok: false, reason: 'replayed' });

    const metrics = getOwnershipMetrics();
    expect(metrics.challengesIssued).toBe(1);
    expect(metrics.verified).toBe(1);
    expect(metrics.rejected.replayed).toBe(1);
  });

  it('binds the challenge message to the address, nonce and expiry', () => {
    const challenge = issueOwnershipChallenge(owner.publicKey(), 0);
    expect(challenge.message).toContain(owner.publicKey());
    expect(challenge.message).toContain(challenge.nonce);
    expect(challenge.message).toContain(new Date(challenge.expires_at).toISOString());
  });

  it('is valid strictly before expiry and rejected at the boundary', () => {
    const now = 1_700_000_000_000;
    const a = issueOwnershipChallenge(owner.publicKey(), now);
    const b = issueOwnershipChallenge(owner.publicKey(), now);
    const expiresAt = now + CONFIG.ownershipChallengeTtlMs;

    const proofA = {
      stellarAddress: owner.publicKey(),
      nonce: a.nonce,
      signature: sign(owner, a.message),
    };
    const proofB = {
      stellarAddress: owner.publicKey(),
      nonce: b.nonce,
      signature: sign(owner, b.message),
    };

    expect(verifyOwnershipProof(proofA, expiresAt - 1).ok).toBe(true);
    expect(verifyOwnershipProof(proofB, expiresAt)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a signature over a different message', () => {
    const challenge = issueOwnershipChallenge(owner.publicKey(), 0);
    const result = verifyOwnershipProof(
      {
        stellarAddress: owner.publicKey(),
        nonce: challenge.nonce,
        signature: sign(owner, 'other'),
      },
      1
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects garbage signatures and unknown nonces without throwing', () => {
    const challenge = issueOwnershipChallenge(owner.publicKey(), 0);
    expect(
      verifyOwnershipProof(
        { stellarAddress: owner.publicKey(), nonce: challenge.nonce, signature: '!!not-base64!!' },
        1
      )
    ).toEqual({ ok: false, reason: 'invalid_signature' });
    expect(
      verifyOwnershipProof(
        { stellarAddress: owner.publicKey(), nonce: 'does-not-exist', signature: 'AAAA' },
        1
      )
    ).toEqual({ ok: false, reason: 'unknown_challenge' });
    expect(
      verifyOwnershipProof({ stellarAddress: 'GNOTAKEY', nonce: 'x', signature: 'y' }, 1)
    ).toEqual({ ok: false, reason: 'invalid_address' });
    expect(
      verifyOwnershipProof(
        { stellarAddress: owner.publicKey(), nonce: undefined, signature: 'y' },
        1
      )
    ).toEqual({ ok: false, reason: 'missing_proof' });
  });

  it('refuses to issue a challenge for an invalid address', () => {
    expect(() => issueOwnershipChallenge('GABCD1234')).toThrow(/valid Stellar public key/);
  });

  it('still rejects a consumed proof after a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iln-ownership-'));
    const path = join(dir, 'notifications.sqlite');
    try {
      const first = createDb(path);
      setDb(first);
      const challenge = issueOwnershipChallenge(owner.publicKey(), 0);
      const proof = {
        stellarAddress: owner.publicKey(),
        nonce: challenge.nonce,
        signature: sign(owner, challenge.message),
      };
      expect(verifyOwnershipProof(proof, 1).ok).toBe(true);
      first.close();

      // Simulated restart: fresh connection, fresh in-memory counters.
      resetOwnershipMetrics();
      const second = createDb(path);
      setDb(second);
      expect(verifyOwnershipProof(proof, 2)).toEqual({ ok: false, reason: 'replayed' });
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a pre-#1281 database, leaving existing subscriptions unverified', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iln-ownership-'));
    const path = join(dir, 'legacy.sqlite');
    try {
      const legacy = new Database(path);
      legacy.exec(`
        CREATE TABLE subscriptions (
          id INTEGER PRIMARY KEY, stellar_address TEXT NOT NULL,
          channel TEXT NOT NULL, destination TEXT NOT NULL, triggers TEXT NOT NULL,
          webhook_secret TEXT, created_at INTEGER NOT NULL
        );
        INSERT INTO subscriptions (stellar_address, channel, destination, triggers, created_at)
        VALUES ('GLEGACY', 'email', 'legacy@example.com', '[]', 0);
      `);
      legacy.close();

      const migrated = createDb(path);
      setDb(migrated);
      const row = migrated
        .prepare('SELECT ownership_verified_at FROM subscriptions WHERE stellar_address = ?')
        .get('GLEGACY') as { ownership_verified_at: number | null };
      expect(row.ownership_verified_at).toBeNull();
      expect(getOwnershipMetrics().unverifiedSubscriptions).toBe(1);
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propagates storage failures so callers fail closed', () => {
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
