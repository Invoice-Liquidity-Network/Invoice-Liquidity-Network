import pc from "picocolors";

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
    typeof error === "object" &&
    error !== null &&
    typeof (error as StructuredError).code === "string" &&
    typeof (error as StructuredError).remediation === "string"
  );
}

/**
 * Wrap `text` in an OSC 8 terminal hyperlink pointing at `url`. Terminals that
 * do not understand the escape sequence simply render `text`, so this is safe
 * to emit unconditionally when hyperlinks are enabled.
 */
export function osc8Hyperlink(url: string, text: string): string {
  const OSC = String.fromCharCode(27) + "]8;;";
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
  options: FormatILNErrorOptions = {},
): string {
  const useColor = options.color ?? true;
  const paint = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  const lines: string[] = [];

  lines.push(`${paint(pc.red, paint(pc.bold, "error"))} ${error.message}`);
  lines.push(`  ${paint(pc.dim, "code")}        ${error.code}`);
  lines.push(`  ${paint(pc.cyan, "fix")}         ${error.remediation}`);

  if (error.retryable) {
    lines.push(`  ${paint(pc.yellow, "retryable")}   this operation can be retried`);
  }

  if (error.docsUrl) {
    const link = options.hyperlinks
      ? osc8Hyperlink(error.docsUrl, error.docsUrl)
      : error.docsUrl;
    lines.push(`  ${paint(pc.dim, "docs")}        ${paint(pc.underline, link)}`);
  }

  return lines.join("\n");
}

const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  1: "Invoice not found.",
  2: "Invoice has already been funded.",
  3: "Invoice has already been paid.",
  4: "Invoice is not funded yet.",
  5: "Unauthorized for this operation.",
  6: "Invalid amount. Amount must be greater than zero.",
  7: "Invalid discount rate. Use a value between 1 and the configured maximum.",
  8: "Invalid due date. Use a future date.",
  9: "Invoice has defaulted.",
  10: "Nothing to claim for this invoice.",
  11: "Invoice is not yet eligible for default actions.",
  12: "Funding amount exceeds the remaining balance.",
  13: "Invoice has expired.",
  14: "Batch size is too large.",
};

export function explainContractError(code: number): string {
  return CONTRACT_ERROR_MESSAGES[code] ?? `Contract returned error code ${code}.`;
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error.";
}
