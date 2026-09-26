/**
 * oracle-service/src/audit-trail.ts
 *
 * Immutable, append-only, tamper-evident record of every verdict
 * oracle-service publishes (issue #1055).
 *
 * What "tamper-evident" has to mean here
 * ───────────────────────────────────────
 * Hash chaining alone is not enough. Anyone with write access to the store can
 * recompute a chain over edited rows, so every entry also carries an
 * HMAC-SHA256 signature produced with `ORACLE_AUDIT_KEY`, a secret that lives
 * outside the audit database. Detecting tampering therefore requires both:
 *
 *   hash      = sha256(prevHash + payload)          — ordering & deletion
 *   payload   = JSON({ content, signature })
 *   signature = HMAC(auditKey, JSON(content))        — authenticity of content
 *
 * `verifyIntegrity()` re-derives both from the stored bytes rather than from
 * anything held in memory, so it also catches:
 *   - a removed row (sequence gap),
 *   - a reordered chain (prevHash mismatch),
 *   - a rewritten indexed column (projection no longer matches its payload),
 *   - a re-hashed history (HMAC no longer verifies),
 *   - a wholesale deletion by retention beyond what the signed anchor allows.
 *
 * Retention
 * ─────────
 * `docs/privacy.md` §4 requires oracle attestation logs to be kept for one
 * year for audit readiness — and no longer than that. Purging is not a plain
 * `DELETE`: each purge writes a *signed anchor* recording the sequence number
 * and hash of the last row removed. Integrity checks resume from that anchor,
 * which makes "delete the head of the chain to hide an edit" detectable: the
 * surviving rows must still chain onto a anchor the audit key vouches for.
 */

import { createHash, createHmac } from 'crypto';

import type { AuditAnchorRecord, AuditRow, AuditRowStore } from './audit-store';
import type { OracleCompositionOutcome, OracleVerificationResponse } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The inputs the verdict was computed from. Stored verbatim so an auditor can
 * reconstruct *why* a payer was accepted, not just that they were.
 */
export interface AuditEntryContent {
  seq: number;
  requestId: string;
  payer: string;
  invoiceId: string;
  amount: string;
  trustScore: number;
  confidence: number;
  isVerified: boolean;
  outcome: OracleCompositionOutcome;
  fraudSignals: string[];
  /** True when the verdict was served from cache rather than recomputed. */
  cacheHit: boolean;
  dataAgeMs: number;
  /** ISO-8601 timestamp carried by the published verdict itself. */
  generatedAt: string;
  reputationScore: number;
  historicalSuccessRate: number;
  historicalDefaultRate: number;
  averageHistoricalAmount: string;
  amountDeviation: number;
  settlementVarianceDays: number;
}

export interface AuditEntry extends AuditEntryContent {
  /** HMAC-SHA256 over the canonical JSON of {@link AuditEntryContent}. */
  signature: string;
  /** Hash of the previous entry; the signed retention anchor after a purge. */
  prevHash: string;
  /** sha256(prevHash + JSON({ content, signature })). */
  hash: string;
}

export interface AuditQuery {
  from?: string;
  to?: string;
  payer?: string;
  invoiceId?: string;
  limit?: number;
  offset?: number;
}

export interface IntegrityCheckResult {
  valid: boolean;
  /** Rows examined by this run. */
  entries: number;
  /** Sequence the walk started from: the anchor, or 0 for an untouched trail. */
  checkedFromSeq: number;
  /** Hash the chain resumed from, when a retention purge has happened. */
  anchorSeq?: number;
  /** First seq whose recomputed hash does not match — edit, reorder, or rewind. */
  brokenAt?: number;
  /** First seq whose HMAC does not match — content rewritten and re-hashed. */
  badSignatureAt?: number;
  /** First seq that is not `previous + 1` — a row was deleted. */
  gapAt?: number;
  /** First seq whose indexed columns disagree with its own payload. */
  columnMismatchAt?: number;
  /** Stored anchor failed its own signature check — history was truncated. */
  anchorInvalid?: boolean;
  checkedAt: string;
}

export interface AuditTrailOptions {
  /**
   * Store to persist to. Required: an audit trail that silently defaults to
   * memory would lose its contents on restart while still reporting success, so
   * the caller has to choose the durability guarantee explicitly.
   */
  store: AuditRowStore;
  /** HMAC key. Defaults to `ORACLE_AUDIT_KEY`. */
  auditKey?: string;
  /** How long entries must be kept. Defaults to 365 days (docs/privacy.md §4). */
  retentionMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Audit-readiness window from `docs/privacy.md` §4: one year. */
export const DEFAULT_AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

const DEV_AUDIT_KEY = 'dev-oracle-audit-key-do-not-use-in-production';

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmacHex(key: string, input: string): string {
  return createHmac('sha256', key).update(input).digest('hex');
}

function safeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && bufA.equals(bufB);
}

/**
 * Fixed key order. `JSON.stringify` follows insertion order, so re-emitting the
 * object literal below is what makes the stored bytes reproducible; a payload
 * that was re-serialised by a different code path will not hash the same.
 */
const CONTENT_KEY_ORDER = [
  'seq',
  'requestId',
  'payer',
  'invoiceId',
  'amount',
  'trustScore',
  'confidence',
  'isVerified',
  'outcome',
  'fraudSignals',
  'cacheHit',
  'dataAgeMs',
  'generatedAt',
  'reputationScore',
  'historicalSuccessRate',
  'historicalDefaultRate',
  'averageHistoricalAmount',
  'amountDeviation',
  'settlementVarianceDays',
] as const satisfies readonly (keyof AuditEntryContent)[];

export function canonicalizeContent(content: AuditEntryContent): string {
  const ordered: Record<string, unknown> = {};
  for (const key of CONTENT_KEY_ORDER) ordered[key] = content[key];
  return JSON.stringify(ordered);
}

function contentFromResponse(response: OracleVerificationResponse, seq: number): AuditEntryContent {
  return {
    seq,
    requestId: response.requestId,
    payer: response.payer,
    invoiceId: response.invoiceId,
    amount: response.amount,
    trustScore: response.trustScore,
    confidence: response.confidence,
    isVerified: response.isVerified,
    outcome: response.composition.outcome,
    fraudSignals: [...response.fraudSignals],
    cacheHit: response.cacheHit,
    dataAgeMs: response.dataAgeMs,
    generatedAt: response.generatedAt,
    reputationScore: response.reputationScore,
    historicalSuccessRate: response.historicalSuccessRate,
    historicalDefaultRate: response.historicalDefaultRate,
    averageHistoricalAmount: response.averageHistoricalAmount,
    amountDeviation: response.amountDeviation,
    settlementVarianceDays: response.settlementVarianceDays,
  };
}

interface PayloadEnvelope {
  content: AuditEntryContent;
  /**
   * Stored inside the payload rather than only in the row's hash column so a
   * single exported row still shows what it was chained to.
   */
  prevHash: string;
  signature: string;
}

function parsePayload(payload: string): PayloadEnvelope | null {
  try {
    const parsed = JSON.parse(payload) as PayloadEnvelope;
    if (!parsed || typeof parsed !== 'object' || !parsed.content) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AuditTrail
// ---------------------------------------------------------------------------

export class AuditTrail {
  private readonly store: AuditRowStore;
  private readonly auditKey: string;
  private readonly retentionMs: number;
  private readonly now: () => number;

  /**
   * Serialises appends. `lastRow()` → `insert()` is a read-modify-write on the
   * chain head, so two publications that interleave would produce two entries
   * claiming the same `prevHash`, silently forking (and then failing) the chain.
   */
  private appendQueue: Promise<unknown> = Promise.resolve();

  constructor(opts: AuditTrailOptions) {
    this.store = opts.store;
    this.auditKey = opts.auditKey ?? process.env.ORACLE_AUDIT_KEY ?? DEV_AUDIT_KEY;
    this.retentionMs = opts.retentionMs ?? DEFAULT_AUDIT_RETENTION_MS;
    this.now = opts.now ?? Date.now;
  }

  // ── Write path ─────────────────────────────────────────────────────────────

  /**
   * Append one published verdict. Resolves only once the row is durable, so a
   * caller that awaits this cannot serve a verdict that is not recorded.
   */
  append(response: OracleVerificationResponse): Promise<AuditEntry> {
    const task = this.appendQueue.then(() => this.appendNow(response));
    // Keep the queue alive even when an append rejects.
    this.appendQueue = task.catch(() => undefined);
    return task;
  }

  private async appendNow(response: OracleVerificationResponse): Promise<AuditEntry> {
    const anchor = await this.readAnchor();
    const last = await this.store.lastRow();

    const prevHash = last ? last.hash : anchor?.hash ?? '';
    const prevSeq = last ? last.seq : anchor?.seq ?? 0;
    const seq = prevSeq + 1;

    const content = contentFromResponse(response, seq);
    const signature = hmacHex(this.auditKey, canonicalizeContent(content));
    const payload = JSON.stringify({ content, prevHash, signature } satisfies PayloadEnvelope);
    const hash = sha256Hex(prevHash + payload);

    const row: AuditRow = {
      seq,
      generatedAt: content.generatedAt,
      payer: content.payer,
      invoiceId: content.invoiceId,
      amount: content.amount,
      isVerified: content.isVerified,
      trustScore: content.trustScore,
      outcome: content.outcome,
      hash,
      payload,
    };
    await this.store.insert(row);

    return { ...content, signature, prevHash, hash };
  }

  // ── Read path ──────────────────────────────────────────────────────────────

  /** Entries for a time range and/or feed, oldest first. */
  async getEntries(query: AuditQuery = {}): Promise<AuditEntry[]> {
    const rows = await this.store.query(query);
    return rows.map((row) => rowToEntry(row));
  }

  /** Rows matching `query`, ignoring its paging — the total behind a page. */
  async count(query: AuditQuery = {}): Promise<number> {
    return this.store.count(query);
  }

  // ── Integrity ──────────────────────────────────────────────────────────────

  /**
   * Re-derive the whole chain from the store and report the first inconsistency.
   * Safe to run against a live trail; it never writes.
   */
  async verifyIntegrity(): Promise<IntegrityCheckResult> {
    const checkedAt = new Date(this.now()).toISOString();
    const anchor = await this.readAnchor();

    const base: IntegrityCheckResult = {
      valid: true,
      entries: 0,
      checkedFromSeq: anchor?.seq ?? 0,
      checkedAt,
    };
    if (anchor) {
      base.anchorSeq = anchor.seq;
      if (!this.anchorIsValid(anchor)) {
        return { ...base, valid: false, anchorInvalid: true };
      }
    }

    const rows = await this.store.rowsAfter(anchor?.seq ?? 0);
    let prevHash = anchor?.hash ?? '';
    let prevSeq = anchor?.seq ?? 0;

    for (const row of rows) {
      if (row.seq !== prevSeq + 1) {
        return { ...base, valid: false, gapAt: row.seq, entries: rows.length };
      }

      const envelope = parsePayload(row.payload);
      if (
        !envelope ||
        !safeHexEqual(
          hmacHex(this.auditKey, canonicalizeContent(envelope.content)),
          envelope.signature
        )
      ) {
        return { ...base, valid: false, badSignatureAt: row.seq, entries: rows.length };
      }

      if (sha256Hex(prevHash + row.payload) !== row.hash) {
        return { ...base, valid: false, brokenAt: row.seq, entries: rows.length };
      }

      const mismatch = columnMismatch(row, envelope.content);
      if (mismatch) {
        return { ...base, valid: false, columnMismatchAt: row.seq, entries: rows.length };
      }

      prevHash = row.hash;
      prevSeq = row.seq;
    }

    return { ...base, entries: rows.length };
  }

  /**
   * Verify the trail with the key *not* held by the process, for out-of-band
   * auditor use: `verifyAuditTrail({ store, auditKey })` against a copy of the
   * database. Catches the case where the service's own key was rotated and the
   * operator re-signed history.
   */
  static async verifyWithKey(
    store: AuditRowStore,
    auditKey: string,
    opts: { now?: () => number } = {}
  ): Promise<IntegrityCheckResult> {
    const trail = new AuditTrail({ store, auditKey, now: opts.now });
    return trail.verifyIntegrity();
  }

  // ── Retention ──────────────────────────────────────────────────────────────

  /**
   * Delete entries older than the retention window and record what was removed.
   * Returns the number of rows purged (0 when nothing is out of range).
   */
  async enforceRetention(): Promise<number> {
    const cutoff = new Date(this.now() - this.retentionMs).toISOString();
    const expired = await this.store.query({ to: cutoff });
    if (expired.length === 0) return 0;

    const lastExpired = expired[expired.length - 1];

    // Anchor first, then delete: a crash in between leaves an anchor covering
    // rows that are still present (harmless — they chain onto it either way),
    // whereas deleting first would leave a chain whose head cannot be proved.
    await this.writeAnchor(lastExpired);
    return this.store.deleteThrough(lastExpired.seq);
  }

  /** The signed record of what retention has removed, if any. */
  async getRetentionAnchor(): Promise<AuditAnchorRecord | null> {
    const anchor = await this.store.getAnchor();
    if (!anchor) return null;
    return this.anchorIsValid(anchor) ? anchor : null;
  }

  /** How long entries are kept before retention removes them. */
  get retentionWindowMs(): number {
    return this.retentionMs;
  }

  async close(): Promise<void> {
    await this.appendQueue;
    await this.store.close();
  }

  // ── Anchor helpers ─────────────────────────────────────────────────────────

  private anchorSignature(anchor: Omit<AuditAnchorRecord, 'signature'>): string {
    return hmacHex(this.auditKey, `${anchor.seq}:${anchor.hash}:${anchor.purgedThrough}`);
  }

  private async writeAnchor(row: AuditRow): Promise<void> {
    const withoutSignature = {
      seq: row.seq,
      hash: row.hash,
      purgedThrough: row.seq,
      purgedAt: new Date(this.now()).toISOString(),
    };
    await this.store.setAnchor({
      ...withoutSignature,
      signature: this.anchorSignature(withoutSignature),
    });
  }

  private async readAnchor(): Promise<AuditAnchorRecord | null> {
    return this.store.getAnchor();
  }

  private anchorIsValid(anchor: AuditAnchorRecord): boolean {
    const { signature, ...withoutSignature } = anchor;
    return safeHexEqual(this.anchorSignature(withoutSignature), signature);
  }
}

// ---------------------------------------------------------------------------
// Row → entry
// ---------------------------------------------------------------------------

function rowToEntry(row: AuditRow): AuditEntry {
  const envelope = parsePayload(row.payload);
  if (!envelope) {
    throw new Error(`AuditTrail: row ${row.seq} has an unreadable payload`);
  }
  return {
    ...envelope.content,
    signature: envelope.signature,
    prevHash: envelope.prevHash,
    hash: row.hash,
  };
}

/**
 * Compare the indexed projection columns against the payload they duplicate.
 * A query filters on columns while the response body comes from the payload, so
 * rewriting a column is how an attacker would hide a payer's history from a
 * range query while leaving the chain intact.
 */
function columnMismatch(row: AuditRow, content: AuditEntryContent): boolean {
  return (
    row.seq !== content.seq ||
    row.generatedAt !== content.generatedAt ||
    row.payer !== content.payer ||
    row.invoiceId !== content.invoiceId ||
    row.amount !== content.amount ||
    row.isVerified !== content.isVerified ||
    row.trustScore !== content.trustScore ||
    row.outcome !== content.outcome ||
    row.hash === ''
  );
}
