/**
 * oracle-service/src/audit-trail.ts
 *
 * Immutable, append-only, tamper-evident historical price audit trail.
 *
 * Hash chaining
 * ─────────────
 * Each entry's hash is: sha256(prevHash + JSON.stringify(entryWithoutHash))
 * The genesis entry uses an empty string as prevHash.
 *
 * Integrity signature
 * ───────────────────
 * Each entry is also HMAC-signed with ORACLE_AUDIT_KEY (default dev key) so
 * that an out-of-band verifier can confirm entries have not been modified
 * individually, independent of the chain.
 */

import { createHash, createHmac } from 'crypto';
import type { OracleVerificationResponse } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** 1-based monotonically increasing sequence number. */
  seq: number;
  payer: string;
  invoiceId: string;
  amount: string;
  trustScore: number;
  isVerified: boolean;
  generatedAt: string;
  /** HMAC-SHA256 hex of the entry content (excluding `hash`). */
  signature: string;
  /** Hash of the previous entry (empty string for the first entry). */
  prevHash: string;
  /** sha256(prevHash + JSON.stringify(entry without hash)). */
  hash: string;
}

export interface GetEntriesOptions {
  from?: string;  // ISO-8601 date-time; inclusive lower bound on generatedAt
  to?: string;    // ISO-8601 date-time; inclusive upper bound on generatedAt
  payer?: string; // filter by exact payer address
}

export interface IntegrityCheckResult {
  valid: boolean;
  /** 1-based seq of the first entry whose hash chain is broken, if any. */
  brokenAt?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEV_AUDIT_KEY = 'dev-oracle-audit-key-do-not-use-in-production';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmacHex(key: string, input: string): string {
  return createHmac('sha256', key).update(input).digest('hex');
}

// ---------------------------------------------------------------------------
// AuditTrail
// ---------------------------------------------------------------------------

export class AuditTrail {
  private readonly entries: AuditEntry[] = [];
  private readonly auditKey: string;

  constructor(auditKey?: string) {
    this.auditKey =
      auditKey ?? process.env.ORACLE_AUDIT_KEY ?? DEV_AUDIT_KEY;
  }

  /**
   * Append the result of a successful verification to the audit log.
   * Returns the newly created AuditEntry.
   */
  append(response: OracleVerificationResponse): AuditEntry {
    const seq = this.entries.length + 1;
    const prevHash = this.entries.length > 0
      ? this.entries[this.entries.length - 1].hash
      : '';

    // Build the entry content (without hash) for signing / hashing.
    const content: Omit<AuditEntry, 'hash'> = {
      seq,
      payer: response.payer,
      invoiceId: response.invoiceId,
      amount: response.amount,
      trustScore: response.trustScore,
      isVerified: response.isVerified,
      generatedAt: response.generatedAt,
      signature: '', // placeholder — will be replaced below
      prevHash,
    };

    // Signature covers all content fields (signature field itself is empty here).
    const contentJson = JSON.stringify(content);
    content.signature = hmacHex(this.auditKey, contentJson);

    // Hash chains: sha256(prevHash + JSON.stringify(entry without hash)).
    const entryWithoutHash: Omit<AuditEntry, 'hash'> = { ...content };
    const hash = sha256Hex(prevHash + JSON.stringify(entryWithoutHash));

    const entry: AuditEntry = { ...entryWithoutHash, hash };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Query the audit log with optional filters.
   */
  getEntries(opts: GetEntriesOptions = {}): AuditEntry[] {
    return this.entries.filter((entry) => {
      if (opts.payer && entry.payer !== opts.payer) return false;
      if (opts.from && entry.generatedAt < opts.from) return false;
      if (opts.to && entry.generatedAt > opts.to) return false;
      return true;
    });
  }

  /**
   * Walk the chain and confirm every entry's hash is consistent with its
   * predecessor.  Returns valid=true if the chain is intact, or valid=false
   * with brokenAt pointing to the first corrupted seq.
   */
  verifyIntegrity(): IntegrityCheckResult {
    let prevHash = '';
    for (const entry of this.entries) {
      const { hash, ...rest } = entry;
      const expected = sha256Hex(prevHash + JSON.stringify(rest));
      if (expected !== hash) {
        return { valid: false, brokenAt: entry.seq };
      }
      prevHash = hash;
    }
    return { valid: true };
  }

  /** Total number of entries (for the integrity endpoint). */
  get size(): number {
    return this.entries.length;
  }
}
