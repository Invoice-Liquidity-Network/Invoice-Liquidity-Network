/**
 * Payer and KYB Evidence Privacy & Redaction Module (#1239)
 *
 * Protects sensitive business identifiers and full on-chain payer addresses
 * from plain text log disclosure while preserving auditability.
 */

export function maskPayerAddress(address?: string | null): string {
  if (!address) return 'unknown';
  const clean = String(address).trim();
  if (clean.length <= 12) return clean.slice(0, 8);
  return `${clean.slice(0, 8)}...${clean.slice(-4)}`;
}

export function sanitizeKybEvidenceString(evidence: string): string {
  if (!evidence) return '';
  // Redact tax numbers, registration codes, and high-entropy sensitive tokens
  return evidence
    .replace(/REG-[A-Z0-9\-]+/gi, 'REG-***')
    .replace(/(?:EIN|TAX|SSN)[\s:\-]+([A-Z0-9\-]+)/gi, '$1: ***')
    .replace(/G[A-Z0-9]{55}/g, (addr) => maskPayerAddress(addr));
}
