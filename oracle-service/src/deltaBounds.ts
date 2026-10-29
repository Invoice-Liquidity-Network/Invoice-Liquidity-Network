/**
 * Manipulation-resistant bounds on single-update movement (issue #1052).
 *
 * Each feed is a per-payer signal stream: the value we publish for a payer
 * moves over time as their behaviour moves. A single update that jumps far
 * beyond what that feed has *realistically* ever moved in one step is either a
 * data-integrity incident or an attacker steering the oracle — publishing it on
 * the strength of one source is exactly the failure mode a manipulation-
 * resistant oracle must refuse.
 *
 * The guard therefore implements three behaviours, in order of severity:
 *
 *   1. Within-bound movement       → publish normally.
 *   2. Over-bound, quorum-confirmed→ publish, but only because N independent
 *                                     sources agree on the new value.
 *   3. Over-bound, no quorum       → HOLD: the update is recorded in a
 *                                     review queue (bounded, oldest-first,
 *                                     never silently dropped) and flagged for
 *                                     alerting. What the *protocol* receives
 *                                     during a hold follows the fail-safe
 *                                     rule: a worsening move is adopted
 *                                     immediately (freezing it out would let
 *                                     an attacker publish "clean" while the
 *                                     payer turns fraudulent), while an
 *                                     improving move is frozen at the last
 *                                     known-good value until a human resolves
 *                                     the hold.
 */

/** Signal streams the oracle publishes per payer, grouped by feed type. */
export const SIGNAL_FEEDS = [
  'history',
  'reputation',
  'external',
  'kyb',
  'composite-trust',
] as const;

export type SignalFeed = (typeof SIGNAL_FEEDS)[number];

export interface FeedBound {
  /** Max one-step movement as a fraction of the last published value. */
  maxRelativeDelta: number;
  /** Max one-step movement in absolute points of the 0..100 signal scale. */
  maxAbsoluteDelta: number;
  /** Independent confirming sources required to publish an over-bound move. */
  quorumSize: number;
}

export interface DeltaBoundsConfig {
  bounds: Record<SignalFeed, FeedBound>;
  /** Cap on the review queue; the oldest held update is evicted past it. */
  maxHeldUpdates: number;
  /** A source confirms when its own value is within this fraction of the proposal. */
  quorumAgreementTolerance: number;
}

/** Defaults tuned for 0..100 point signals; the composite trust score is the
 * tightest because it is what the protocol consumes. */
export function defaultDeltaBoundsConfig(): DeltaBoundsConfig {
  const wide: FeedBound = { maxRelativeDelta: 0.5, maxAbsoluteDelta: 40, quorumSize: 2 };
  return {
    bounds: {
      history: wide,
      reputation: wide,
      external: wide,
      kyb: { maxRelativeDelta: 0.5, maxAbsoluteDelta: 100, quorumSize: 2 },
      'composite-trust': { maxRelativeDelta: 0.25, maxAbsoluteDelta: 25, quorumSize: 2 },
    },
    maxHeldUpdates: 100,
    quorumAgreementTolerance: 0.25,
  };
}

function readNumber(env: Record<string, string | undefined>, key: string): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Env overrides, per feed:
 *   ORACLE_DELTA_BOUND_<FEED>_RELATIVE / _ABSOLUTE / _QUORUM
 * plus ORACLE_DELTA_MAX_HELD_UPDATES and ORACLE_DELTA_QUORUM_TOLERANCE.
 * `<FEED>` is the feed name upper-cased with `-` replaced by `_`.
 */
export function loadDeltaBoundsConfig(
  env: Record<string, string | undefined> = process.env
): DeltaBoundsConfig {
  const config = defaultDeltaBoundsConfig();

  for (const feed of SIGNAL_FEEDS) {
    const prefix = `ORACLE_DELTA_BOUND_${feed.toUpperCase().replace(/-/g, '_')}`;
    const bound = config.bounds[feed];
    bound.maxRelativeDelta = readNumber(env, `${prefix}_RELATIVE`) ?? bound.maxRelativeDelta;
    bound.maxAbsoluteDelta = readNumber(env, `${prefix}_ABSOLUTE`) ?? bound.maxAbsoluteDelta;
    bound.quorumSize = readNumber(env, `${prefix}_QUORUM`) ?? bound.quorumSize;
  }

  config.maxHeldUpdates = readNumber(env, 'ORACLE_DELTA_MAX_HELD_UPDATES') ?? config.maxHeldUpdates;
  config.quorumAgreementTolerance =
    readNumber(env, 'ORACLE_DELTA_QUORUM_TOLERANCE') ?? config.quorumAgreementTolerance;

  return config;
}

export interface DeltaBoundsKey {
  feed: SignalFeed;
  subject: string;
}

/** One source's independent reading of the same signal. `ok` is false when the
 * source failed or returned nothing usable — a failed source never confirms. */
export interface SourceConfirmation {
  source: string;
  value: number;
  ok: boolean;
}

export interface HeldDeltaUpdate {
  id: string;
  feed: SignalFeed;
  subject: string;
  lastPublishedValue: number;
  proposedValue: number;
  delta: number;
  bound: number;
  confirmingSources: string[];
  heldAtMs: number;
}

export type DeltaBoundsDecision =
  | { decision: 'publish' }
  | {
      decision: 'publish-quorum';
      delta: number;
      bound: number;
      confirmingSources: string[];
    }
  | {
      decision: 'hold';
      heldId: string;
      delta: number;
      bound: number;
      confirmingSources: string[];
    };

export interface DeltaBoundsStats {
  /** Updates currently in the review queue awaiting a human. */
  activeHolds: number;
  /** Every held update ever recorded, including evicted ones. */
  totalHeld: number;
  /** Held updates dropped from the queue by the capacity cap. */
  totalEvicted: number;
  /** Over-bound updates published because a source quorum confirmed them. */
  totalQuorumPublished: number;
  /** Resolutions applied by an operator, by outcome. */
  accepted: number;
  rejected: number;
}

function guardKey(key: DeltaBoundsKey): string {
  return `${key.feed}:${key.subject}`;
}

export class DeltaBoundsGuard {
  private readonly config: DeltaBoundsConfig;
  private readonly published = new Map<string, number>();
  private readonly held: HeldDeltaUpdate[] = [];
  private holdSeq = 0;
  private totalHeld = 0;
  private totalEvicted = 0;
  private totalQuorumPublished = 0;
  private accepted = 0;
  private rejected = 0;

  constructor(config: DeltaBoundsConfig = defaultDeltaBoundsConfig()) {
    this.config = config;
  }

  /**
   * Judge one proposed update to a feed's published value.
   *
   * The first observation of a key has nothing to compare against, so it
   * publishes and becomes the reference the bound is computed from.
   */
  assess(
    key: DeltaBoundsKey,
    proposedValue: number,
    sourceConfirmations: SourceConfirmation[],
    nowMs: number
  ): DeltaBoundsDecision {
    const id = guardKey(key);
    const previous = this.published.get(id);
    const boundConfig = this.config.bounds[key.feed];
    // The bound scales with the last value but never below the absolute floor,
    // so small values are not held hostage by the relative term alone.
    const bound =
      previous === undefined
        ? 0
        : Math.max(boundConfig.maxAbsoluteDelta, boundConfig.maxRelativeDelta * Math.abs(previous));
    const delta = previous === undefined ? 0 : Math.abs(proposedValue - previous);

    if (previous === undefined || delta <= bound) {
      this.published.set(id, proposedValue);
      return { decision: 'publish' };
    }

    const confirming = sourceConfirmations.filter(
      (c) => c.ok && this.agreesWith(c.value, proposedValue)
    );
    const confirmingSources = confirming.map((c) => c.source);

    if (confirming.length >= boundConfig.quorumSize) {
      this.published.set(id, proposedValue);
      this.totalQuorumPublished += 1;
      return { decision: 'publish-quorum', delta, bound, confirmingSources };
    }

    // Hold, do not drop: the proposal is preserved for review regardless of
    // direction. Direction decides only what gets *published*, never what gets
    // recorded — a frozen "clean" masking a sudden deterioration would be the
    // single worst failure mode this guard could have.
    const worsening = proposedValue < previous;
    if (worsening) {
      this.published.set(id, proposedValue);
    }
    this.holdSeq += 1;
    const held: HeldDeltaUpdate = {
      id: `hold-${this.holdSeq}`,
      feed: key.feed,
      subject: key.subject,
      lastPublishedValue: previous,
      proposedValue,
      delta,
      bound,
      confirmingSources,
      heldAtMs: nowMs,
    };
    this.held.push(held);
    this.totalHeld += 1;
    if (this.held.length > this.config.maxHeldUpdates) {
      this.held.shift();
      this.totalEvicted += 1;
    }

    return {
      decision: 'hold',
      heldId: held.id,
      delta,
      bound,
      confirmingSources,
    };
  }

  /** The value currently being published for a key, if one exists. */
  lastPublishedValue(key: DeltaBoundsKey): number | undefined {
    return this.published.get(guardKey(key));
  }

  /** Pending over-bound updates awaiting human review, oldest first. */
  getHeldUpdates(): HeldDeltaUpdate[] {
    return this.held.map((update) => ({ ...update }));
  }

  getStats(): DeltaBoundsStats {
    return {
      activeHolds: this.held.length,
      totalHeld: this.totalHeld,
      totalEvicted: this.totalEvicted,
      totalQuorumPublished: this.totalQuorumPublished,
      accepted: this.accepted,
      rejected: this.rejected,
    };
  }

  /**
   * Explicit human resolution of a held update — the only way a hold leaves
   * the queue. Accepting publishes the held value; rejecting reverts the
   * published value to what it was before the hold. Returns the resolved
   * update, or undefined when the id is unknown.
   */
  resolveHeldUpdate(id: string, resolution: 'accepted' | 'rejected'): HeldDeltaUpdate | undefined {
    const index = this.held.findIndex((update) => update.id === id);
    if (index === -1) {
      return undefined;
    }
    const [update] = this.held.splice(index, 1);
    const key = `${update.feed}:${update.subject}`;
    if (resolution === 'accepted') {
      this.published.set(key, update.proposedValue);
      this.accepted += 1;
    } else {
      this.published.set(key, update.lastPublishedValue);
      this.rejected += 1;
    }
    return { ...update };
  }

  private agreesWith(sourceValue: number, proposedValue: number): boolean {
    const tolerance = this.config.quorumAgreementTolerance * Math.max(1, Math.abs(proposedValue));
    return Math.abs(sourceValue - proposedValue) <= tolerance;
  }
}

/** Metadata attached to a verification response so the request path can alert
 * on bound violations without reaching into guard internals. */
export interface OracleDeltaGuardInfo {
  feed: SignalFeed;
  decision: DeltaBoundsDecision['decision'];
  delta: number;
  bound: number;
  confirmingSources: string[];
  heldId?: string;
}
