/**
 * oracle-service/src/audit-trail.ts
 *
 * Immutable, append-only, tamper-evident record of every verdict,
 * failover event, and authorization publication the oracle publishes (issues #1055, #1486).
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
 * `verifyIntegrity()` and `verifyCompleteness()` re-derive both from the stored bytes
 * rather than from anything held in memory, so they also catch:
 *   - a removed row (sequence gap),
 *   - a reordered chain (prevHash mismatch),
 *   - a rewritten indexed column (projection no longer matches its payload),
 *   - a re-hashed history (HMAC no longer verifies),
 *   - a wholesale deletion by retention beyond what the signed anchor allows.
 *
 * Audit Completeness (#1486)
 * ──────────────────────────
 * Protocol operations require completeness across three distinct event types:
 *   1. Verification events: published or cached verdicts with full heuristic inputs.
 *   2. Failover events: automated switches to secondary/fallback indexer, RPC, or KYB registries.
 *   3. Authorization events: bearer token checks, admin API invocations, and key rotations.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUDIT SPECIFICATION & MATRICES (#1486)
 * ─────────────────────────────────────────────────────────────────────────────
 * - Normal: Every verification, failover, and authorization event is appended sequentially
 *   with an incrementing sequence number, chaining prevHash, and HMAC signature.
 * - Failed: Unhandled upstream crashes causing provider failover record structured failover
 *   entries. Unauthorized API access attempts record authorization rejection entries.
 * - Repeated: High frequency requests are strictly queued through an append queue, preventing
 *   chain branching, duplicate sequence numbers, or race-induced gaps.
 * - Stale: Cached verdicts record `cacheHit: true` and data age, preserving provenance.
 * - Interrupted: Unplanned shutdown resumes sequencing safely from the last durable entry
 *   or signed retention anchor.
 *
 * Source of Truth:
 * - Append-only SQLite/Memory store chained by sha256 and HMAC-SHA256 with `ORACLE_AUDIT_KEY`.
 *
 * Failure Behavior:
 * - Fail-closed: An append rejection prevents publishing decisions unrecorded in the trail.
 *
 * Residual Risk & Maintainer Approval Decisions:
 * - High-frequency failover loops could generate high volume of audit entries.
 *   Mitigation: Purging via signed retention anchors keeps the chain size bounded.
 */

import { createHash, createHmac } from 'crypto';

import type { AuditAnchorRecord, AuditRow, AuditRowStore } from './audit-store';
import type { OracleCompositionOutcome, OracleVerificationResponse } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditEventType = 'verification' | 'failover' | 'authorization';

export interface FailoverAuditDetails {
  sourceId: string;
  primaryProvider: string;
  fallbackProvider: string;
  reason: string;
  durationMs?: number;
  triggerPayer?: string;
}

export interface AuthorizationAuditDetails {
  action: 'bearer_auth' | 'admin_api' | 'key_rotation';
  actor: string;
  permitted: boolean;
  reason?: string;
  keyId?: string;
}

export interface FailoverAuditParams {
  sourceId: string;
  primaryProvider: string;
  fallbackProvider: string;
  reason: string;
  durationMs?: number;
  triggerPayer?: string;
  requestId?: string;
}

export interface AuthorizationAuditParams {
  action: 'bearer_auth' | 'admin_api' | 'key_rotation';
  actor: string;
  permitted: boolean;
  reason?: string;
  keyId?: string;
  requestId?: string;
}

/**
 * The inputs the verdict or event was computed from. Stored verbatim so an auditor can
 * reconstruct *why* a decision was made.
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
  /** Event classification (#1486). Defaults to 'verification' for verdict entries. */
  eventType?: AuditEventType;
  /** Structured failover details when eventType === 'failover'. */
  failoverDetails?: FailoverAuditDetails;
  /** Structured authorization details when eventType === 'authorization'. */
  authorizationDetails?: AuthorizationAuditDetails;
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
  eventType?: AuditEventType;
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

export interface AuditCompletenessResult {
  complete: boolean;
  totalEntries: number;
  verificationCount: number;
  failoverCount: number;
  authorizationCount: number;
  gaps: number[];
  checkedFromSeq: number;
  checkedThroughSeq: number;
  integrityValid: boolean;
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
  'eventType',
  'failoverDetails',
  'authorizationDetails',
] as const;

export function canonicalizeContent(content: AuditEntryContent): string {
  const ordered: Record<string, unknown> = {};
  const record = content as unknown as Record<string, unknown>;
  for (const key of CONTENT_KEY_ORDER) {
    if (key in record && record[key] !== undefined) {
      ordered[key] = record[key];
    }
  }
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
    eventType: 'verification',
  };
}

function contentFromFailover(
  params: FailoverAuditParams,
  seq: number,
  now: () => number
): AuditEntryContent {
  const generatedAt = new Date(now()).toISOString();
  return {
    seq,
    requestId: params.requestId ?? `failover-${params.sourceId}-${now()}`,
    payer: params.triggerPayer ?? `system:failover:${params.sourceId}`,
    invoiceId: `failover:${params.sourceId}`,
    amount: '0',
    trustScore: 0,
    confidence: 0,
    isVerified: false,
    outcome: 'failover' as OracleCompositionOutcome,
    fraudSignals: [params.reason],
    cacheHit: false,
    dataAgeMs: 0,
    generatedAt,
    reputationScore: 0,
    historicalSuccessRate: 0,
    historicalDefaultRate: 0,
    averageHistoricalAmount: '0',
    amountDeviation: 0,
    settlementVarianceDays: 0,
    eventType: 'failover',
    failoverDetails: {
      sourceId: params.sourceId,
      primaryProvider: params.primaryProvider,
      fallbackProvider: params.fallbackProvider,
      reason: params.reason,
      durationMs: params.durationMs,
      triggerPayer: params.triggerPayer,
    },
  };
}

function contentFromAuthorization(
  params: AuthorizationAuditParams,
  seq: number,
  now: () => number
): AuditEntryContent {
  const generatedAt = new Date(now()).toISOString();
  return {
    seq,
    requestId: params.requestId ?? `auth-${params.action}-${now()}`,
    payer: `actor:${params.actor}`,
    invoiceId: `auth:${params.action}`,
    amount: '0',
    trustScore: params.permitted ? 100 : 0,
    confidence: 1,
    isVerified: params.permitted,
    outcome: (params.permitted ? 'authorized' : 'unauthorized') as OracleCompositionOutcome,
    fraudSignals: params.permitted ? [] : [params.reason ?? 'AuthorizationDenied'],
    cacheHit: false,
    dataAgeMs: 0,
    generatedAt,
    reputationScore: 0,
    historicalSuccessRate: 0,
    historicalDefaultRate: 0,
    averageHistoricalAmount: '0',
    amountDeviation: 0,
    settlementVarianceDays: 0,
    eventType: 'authorization',
    authorizationDetails: {
      action: params.action,
      actor: params.actor,
      permitted: params.permitted,
      reason: params.reason,
      keyId: params.keyId,
    },
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
    return this.appendVerification(response);
  }

  /**
   * Append a verification decision event.
   */
  appendVerification(response: OracleVerificationResponse): Promise<AuditEntry> {
    const task = this.appendQueue.then(() =>
      this.appendNow((seq) => contentFromResponse(response, seq))
    );
    this.appendQueue = task.catch(() => undefined);
    return task;
  }

  /**
   * Append a source failover event (#1486).
   */
  appendFailover(params: FailoverAuditParams): Promise<AuditEntry> {
    const task = this.appendQueue.then(() =>
      this.appendNow((seq) => contentFromFailover(params, seq, this.now))
    );
    this.appendQueue = task.catch(() => undefined);
    return task;
  }

  /**
   * Append an authorization check event (#1486).
   */
  appendAuthorization(params: AuthorizationAuditParams): Promise<AuditEntry> {
    const task = this.appendQueue.then(() =>
      this.appendNow((seq) => contentFromAuthorization(params, seq, this.now))
    );
    this.appendQueue = task.catch(() => undefined);
    return task;
  }

  private async appendNow(contentGenerator: (seq: number) => AuditEntryContent): Promise<AuditEntry> {
    const anchor = await this.readAnchor();
    const last = await this.store.lastRow();

    const prevHash = last ? last.hash : anchor?.hash ?? '';
    const prevSeq = last ? last.seq : anchor?.seq ?? 0;
    const seq = prevSeq + 1;

    const content = contentGenerator(seq);
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
    const entries = rows.map((row) => rowToEntry(row));
    if (query.eventType) {
      return entries.filter((e) => (e.eventType ?? 'verification') === query.eventType);
    }
    return entries;
  }

  /** Rows matching `query`, ignoring its paging — the total behind a page. */
  async count(query: AuditQuery = {}): Promise<number> {
    if (query.eventType) {
      const entries = await this.getEntries(query);
      return entries.length;
    }
    return this.store.count(query);
  }

  // ── Integrity & Completeness ────────────────────────────────────────────────

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
   * Verify audit trail completeness across all verification, failover, and
   * authorization events (#1486).
   */
  async verifyCompleteness(): Promise<AuditCompletenessResult> {
    const integrity = await this.verifyIntegrity();
    const rows = await this.store.rowsAfter(integrity.checkedFromSeq);

    let verificationCount = 0;
    let failoverCount = 0;
    let authorizationCount = 0;
    const gaps: number[] = [];
    let expectedSeq = integrity.checkedFromSeq + 1;

    for (const row of rows) {
      if (row.seq !== expectedSeq) {
        gaps.push(row.seq);
      }
      expectedSeq = row.seq + 1;

      const envelope = parsePayload(row.payload);
      const eventType = envelope?.content.eventType ?? 'verification';
      if (eventType === 'failover') {
        failoverCount += 1;
      } else if (eventType === 'authorization') {
        authorizationCount += 1;
      } else {
        verificationCount += 1;
      }
    }

    const lastSeq = rows.length > 0 ? rows[rows.length - 1].seq : integrity.checkedFromSeq;

    return {
      complete: integrity.valid && gaps.length === 0,
      totalEntries: rows.length,
      verificationCount,
      failoverCount,
      authorizationCount,
      gaps,
      checkedFromSeq: integrity.checkedFromSeq,
      checkedThroughSeq: lastSeq,
      integrityValid: integrity.valid,
    };
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
