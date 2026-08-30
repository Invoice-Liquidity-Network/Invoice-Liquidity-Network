import type {
  ExternalVerificationResult,
  OracleCompositionOutcome,
  OracleConfidenceLevel,
  OracleExternalSignal,
  OracleHeuristicSignal,
  OracleSignalComposition,
} from './types';

/**
 * Composition policy for the fraud-heuristic signal and the external
 * KYB/identity signal.
 *
 * ── The reasoning ───────────────────────────────────────────────────────────
 *
 * The two signals answer different questions and are not interchangeable:
 *
 *   - The **fraud heuristic** asks "is this payer's *recent on-chain behaviour*
 *     consistent with a legitimate invoice?" It is evidence about the activity
 *     happening right now.
 *   - The **external provider** asks "is this legal entity *who they claim to
 *     be*?" It is an attestation about identity, typically refreshed on the
 *     order of months.
 *
 * That asymmetry drives the whole policy: **fraud signals are blocking and a
 * KYB pass cannot clear them.** A verified business can still be compromised,
 * coerced, or simply committing fraud; identity attestation says nothing about
 * whether the current burst of near-identical invoices is real. Letting KYB
 * override a fraud flag would make the attestation the single most valuable
 * thing to obtain before an attack, which inverts its purpose.
 *
 * The converse is not symmetric. A missing or negative KYB result is *not*
 * blocking, because this protocol funds pseudonymous on-chain payers by design
 * and most legitimate payers will never appear in a KYB database. Treating
 * `unverified` as disqualifying would reject the majority of honest traffic.
 * Instead the external signal moves **confidence**, not the verdict:
 *
 *   - `verified`   → confidence bonus. Two independent signals agreeing is
 *                    genuinely stronger evidence than one.
 *   - `unverified` → confidence cap. We are not rejecting, but we should not
 *                    claim high confidence about a payer a provider explicitly
 *                    could not confirm.
 *   - `unknown`    → no adjustment at all. "We could not check" must never be
 *                    read as "we checked and it failed", or a provider outage
 *                    silently degrades every verdict in the system.
 *
 * Confidence still has to clear the same threshold as before, so a capped
 * confidence *can* flip a marginal verdict to rejected. That is intended: it
 * is the mechanism by which a weak external signal tightens the bar without
 * being an outright veto.
 *
 * ── Precedence, highest first ────────────────────────────────────────────────
 *
 *   1. Stale source data           → rejected-stale-data
 *   2. Any fraud signal            → rejected-fraud-signals   (KYB cannot clear)
 *   3. Trust or confidence too low → rejected-low-trust
 *   4. Otherwise                   → verified, tagged with whether the external
 *                                    signal corroborated it
 *
 * Staleness outranks fraud only because a stale assessment is not evidence of
 * anything — we would be reporting a fraud verdict we cannot stand behind.
 */

/** Bumped whenever the rules below change, so stored verdicts stay auditable. */
export const COMPOSITION_POLICY_VERSION = 'heuristic-blocking-v1';

/** Minimum trust score for a verified verdict. */
export const MIN_TRUST_SCORE = 70;

/** Minimum composed confidence for a verified verdict. */
export const MIN_CONFIDENCE = 0.55;

/** Confidence added when an external provider corroborates a clean heuristic. */
export const EXTERNAL_VERIFIED_BONUS = 0.15;

/** Confidence ceiling applied when a provider explicitly could not verify. */
export const EXTERNAL_UNVERIFIED_CONFIDENCE_CAP = 0.6;

export function confidenceLevelFromScore(confidence: number): OracleConfidenceLevel {
  if (confidence < 0.4) {
    return 'low';
  }
  if (confidence < 0.75) {
    return 'medium';
  }
  return 'high';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Normalize a provider result (or its absence) into the reported sub-signal. */
export function toExternalSignal(
  external: ExternalVerificationResult | undefined
): OracleExternalSignal {
  if (!external) {
    return {
      status: 'unknown',
      provider: null,
      providerConfidence: null,
      checkedAt: null,
      reasons: [],
    };
  }

  return {
    status: external.status,
    provider: external.provider,
    providerConfidence:
      typeof external.providerConfidence === 'number'
        ? clamp(round(external.providerConfidence), 0, 1)
        : null,
    checkedAt: external.checkedAt ?? null,
    reasons: external.reasons ?? [],
  };
}

/**
 * Apply the external signal to the heuristic's confidence.
 *
 * Kept separate from the verdict so the confidence adjustment is testable in
 * isolation, and so `baseConfidence` can be reported next to the composed one.
 */
export function composeConfidence(
  baseConfidence: number,
  external: OracleExternalSignal
): number {
  if (external.status === 'verified') {
    // A provider that reports its own confidence scales the bonus by it, so a
    // hedged attestation does not count the same as a firm one.
    const weight = external.providerConfidence ?? 1;
    return clamp(round(baseConfidence + EXTERNAL_VERIFIED_BONUS * weight), 0, 1);
  }

  if (external.status === 'unverified') {
    return clamp(round(Math.min(baseConfidence, EXTERNAL_UNVERIFIED_CONFIDENCE_CAP)), 0, 1);
  }

  // 'unknown' — no adjustment.
  return clamp(round(baseConfidence), 0, 1);
}

export interface ComposeVerdictInput {
  trustScore: number;
  baseConfidence: number;
  fraudSignals: string[];
  isFresh: boolean;
  external: ExternalVerificationResult | undefined;
}

export interface ComposedVerdict {
  isVerified: boolean;
  confidence: number;
  confidenceLevel: OracleConfidenceLevel;
  composition: OracleSignalComposition;
  /** Extra evidence lines describing how the signals combined. */
  evidence: string[];
}

/** Apply the policy documented at the top of this file. */
export function composeVerdict(input: ComposeVerdictInput): ComposedVerdict {
  const external = toExternalSignal(input.external);
  const composedConfidence = composeConfidence(input.baseConfidence, external);
  const confidenceLevel = confidenceLevelFromScore(composedConfidence);

  const heuristicPassed =
    input.trustScore >= MIN_TRUST_SCORE &&
    input.baseConfidence >= MIN_CONFIDENCE &&
    input.fraudSignals.length === 0;

  const heuristic: OracleHeuristicSignal = {
    trustScore: input.trustScore,
    confidence: round(input.baseConfidence),
    confidenceLevel: confidenceLevelFromScore(input.baseConfidence),
    fraudSignals: input.fraudSignals,
    passed: heuristicPassed,
  };

  let outcome: OracleCompositionOutcome;
  let rationale: string;
  let isVerified: boolean;

  if (!input.isFresh) {
    outcome = 'rejected-stale-data';
    rationale =
      'Source data is older than the configured maximum oracle age; no verdict can be stood behind.';
    isVerified = false;
  } else if (input.fraudSignals.length > 0) {
    outcome = 'rejected-fraud-signals';
    rationale =
      external.status === 'verified'
        ? 'Fraud heuristics fired. External KYB verification does not clear behavioural fraud signals.'
        : 'Fraud heuristics fired.';
    isVerified = false;
  } else if (input.trustScore < MIN_TRUST_SCORE || composedConfidence < MIN_CONFIDENCE) {
    outcome = 'rejected-low-trust';
    rationale =
      input.trustScore < MIN_TRUST_SCORE
        ? `Trust score ${input.trustScore} is below the ${MIN_TRUST_SCORE} threshold.`
        : `Composed confidence ${composedConfidence} is below the ${MIN_CONFIDENCE} threshold.`;
    isVerified = false;
  } else if (external.status === 'verified') {
    outcome = 'verified-both';
    rationale = 'Heuristics clean and external provider corroborated the payer.';
    isVerified = true;
  } else {
    outcome = 'verified-heuristic-only';
    rationale =
      external.status === 'unverified'
        ? 'Heuristics clean; external provider could not verify the payer, so confidence is capped.'
        : 'Heuristics clean; no external verification available.';
    isVerified = true;
  }

  const evidence: string[] = [];
  if (external.provider) {
    evidence.push(`External verification (${external.provider}): ${external.status}`);
  } else {
    evidence.push('External verification: not configured');
  }
  for (const reason of external.reasons) {
    evidence.push(`External provider note: ${reason}`);
  }
  if (composedConfidence !== round(input.baseConfidence)) {
    evidence.push(
      `Confidence adjusted by external signal: ${round(input.baseConfidence)} → ${composedConfidence}`
    );
  }
  evidence.push(`Composition outcome: ${outcome} — ${rationale}`);

  return {
    isVerified,
    confidence: composedConfidence,
    confidenceLevel,
    evidence,
    composition: {
      policy: COMPOSITION_POLICY_VERSION,
      outcome,
      rationale,
      heuristic,
      external,
      baseConfidence: round(input.baseConfidence),
      composedConfidence,
    },
  };
}
