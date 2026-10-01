import pc from 'picocolors';

/**
 * Structural shape of the SDK's {@link ILNError}. We duck-type rather than
 * importing the class so the formatter also works with plain error-like
 * objects (e.g. deserialized errors) and avoids a hard runtime coupling.
 */
export interface StructuredError {
  message: string;
  code: string;
  remediation: string;
  docsUrl?: string;
  retryable?: boolean;
  context?: Record<string, unknown>;
}

/**
 * Returns true when `error` carries the SDK's structured `ILNError` fields
 * (a machine-readable `code` plus a human-readable `remediation`).
 */
export function isStructuredError(error: unknown): error is StructuredError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as StructuredError).code === 'string' &&
    typeof (error as StructuredError).remediation === 'string'
  );
}

/**
 * Wrap `text` in an OSC 8 terminal hyperlink pointing at `url`. Terminals that
 * do not understand the escape sequence simply render `text`, so this is safe
 * to emit unconditionally when hyperlinks are enabled.
 */
export function osc8Hyperlink(url: string, text: string): string {
  const OSC = String.fromCharCode(27) + ']8;;';
  const BEL = String.fromCharCode(7);
  return OSC + url + BEL + text + OSC + BEL;
}

export interface FormatILNErrorOptions {
  /** Apply ANSI colors. Defaults to picocolors' auto-detection. */
  color?: boolean;
  /** Emit OSC 8 hyperlinks for the docs URL. Defaults to false (plain URL). */
  hyperlinks?: boolean;
}

/**
 * Format a structured SDK error for terminal output: a color-coded severity
 * label, the message, a remediation hint, the machine-readable code, and a
 * documentation link (optionally rendered as a clickable OSC 8 hyperlink).
 */
export function formatILNError(
  error: StructuredError,
  options: FormatILNErrorOptions = {}
): string {
  const useColor = options.color ?? true;
  const paint = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  const lines: string[] = [];

  lines.push(`${paint(pc.red, paint(pc.bold, 'error'))} ${error.message}`);
  lines.push(`  ${paint(pc.dim, 'code')}        ${error.code}`);
  lines.push(`  ${paint(pc.cyan, 'fix')}         ${error.remediation}`);

  if (error.retryable) {
    lines.push(`  ${paint(pc.yellow, 'retryable')}   this operation can be retried`);
  }

  if (error.docsUrl) {
    const link = options.hyperlinks ? osc8Hyperlink(error.docsUrl, error.docsUrl) : error.docsUrl;
    lines.push(`  ${paint(pc.dim, 'docs')}        ${paint(pc.underline, link)}`);
  }

  return lines.join('\n');
}

const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  1: 'Invoice not found.',
  2: 'Invoice has already been funded.',
  3: 'Invoice has already been paid.',
  4: 'Invoice is not funded yet.',
  5: 'Unauthorized for this operation.',
  6: 'Invalid amount. Amount must be greater than zero.',
  7: 'Invalid discount rate. Use a value between 1 and the configured maximum.',
  8: 'Invalid due date. Use a future date.',
  9: 'Invoice has defaulted.',
  10: 'Nothing to claim for this invoice.',
  11: 'Invoice is not yet eligible for default actions.',
  12: 'Funding amount exceeds the remaining balance.',
  13: 'Invoice has expired.',
  14: 'Batch size is too large.',
};

export function explainContractError(code: number): string {
  return CONTRACT_ERROR_MESSAGES[code] ?? `Contract returned error code ${code}.`;
}

/**
 * Governance contract error codes (docs/contracts/governance-contract.md
 * §Error Codes). Kept separate from {@link CONTRACT_ERROR_MESSAGES} — the
 * two contracts don't share a code space, and before this the invoice
 * table was used for governance errors too, so a governance rejection
 * (e.g. code 12, `DelegationCyclePrevented`) either silently mapped to the
 * wrong invoice-contract message or fell through to a generic "Contract
 * returned error code N" instead of surfacing what actually happened
 * (issue #971).
 */
const GOVERNANCE_CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  1: 'Governance contract already initialized.',
  2: 'Proposal not found.',
  3: 'Voting period has closed.',
  4: 'Proposal is not in Active status.',
  5: 'You have zero voting power at this proposal’s snapshot.',
  6: 'You have already voted on this proposal.',
  7: 'Voting is still ongoing.',
  8: 'Total votes are below the required quorum.',
  9: 'Proposal was rejected (against votes met or exceeded for votes).',
  10: 'Proposal has already been finalized.',
  11: 'Cannot delegate voting power to your own address.',
  12: 'Delegation rejected: this would create a cycle in the delegation chain.',
  13: 'Timelock delay has not elapsed yet.',
  14: 'Not authorized for this governance action.',
  15: 'Quorum must be between 1 and 10,000 basis points.',
  16: 'Caller is not the governance admin.',
  17: 'Proposal cannot be vetoed in its current status.',
  18: 'Admin veto power has been disabled.',
  19: 'Proposer balance is below the minimum required to create a proposal.',
};

export function explainGovernanceContractError(code: number): string {
  return GOVERNANCE_CONTRACT_ERROR_MESSAGES[code] ?? `Governance contract returned error code ${code}.`;
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error.';
}
