/**
 * Log redaction for payer and KYB evidence (issue #1239).
 *
 * The oracle sees the most sensitive identifiers in the system: payer wallet
 * addresses and the KYB evidence derived from them (business names,
 * registration numbers, risk signals). None of it belongs in a log line, where
 * it outlives the request, is shipped to a third-party collector, and is
 * readable by anyone with log access. These helpers are the single place that
 * decides how much of an identifier is safe to keep: enough to correlate two
 * lines for the same payer, not enough to identify them on-chain.
 */

/**
 * A Stellar strkey (`G` + 55 base32 characters). Anchored on a word boundary so
 * a full address embedded in a URL, JSON blob, or provider error message is
 * still caught.
 */
const STELLAR_ADDRESS_PATTERN = /\bG[A-Z2-7]{55}\b/g;

/** How many leading characters of an address survive in a log line. */
export const PAYER_LOG_PREFIX_LENGTH = 8;

/**
 * Reduce a payer address to a short, non-identifying prefix for correlation.
 *
 * Eight characters is enough to tell two payers apart in a log without being a
 * usable on-chain handle — the same width already used for span attributes and
 * the mock KYB provider's placeholder business names.
 */
export function truncatePayer(payer: string, visible = PAYER_LOG_PREFIX_LENGTH): string {
  const trimmed = payer.trim();
  if (trimmed.length <= visible) {
    return trimmed;
  }
  return `${trimmed.slice(0, visible)}…`;
}

/**
 * Scrub every full Stellar address out of a free-form string, keeping a short
 * prefix so the redacted text is still diagnosable. Used on provider error
 * messages, which frequently echo the URL (and therefore the payer) back.
 */
export function redactStellarAddresses(text: string): string {
  return text.replace(STELLAR_ADDRESS_PATTERN, (address) => truncatePayer(address));
}

/**
 * Render an unknown thrown value as a redacted, single-line string.
 *
 * Never assume the message is benign: an indexer or RPC client will happily
 * paste the full request URL into its error, and the payer is in that URL.
 */
export function redactErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactStellarAddresses(message);
}
