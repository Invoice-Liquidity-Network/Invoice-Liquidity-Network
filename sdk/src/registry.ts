/**
 * Known official deployment contract IDs for the Invoice Liquidity Network.
 * Updated per release.
 */
export const KNOWN_OFFICIAL_CONTRACT_IDS: readonly string[] = [
  // Core Invoice Liquidity Network testnet deployment
  'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC',
  // Governance contract testnet deployment
  'CD7GOIU3GNK7EZHG7XWBC7VI4NRVGMRCU7X2FOCAPQN6EGTSW46BY4EB',
];

export interface ContractIdVerificationResult {
  isOfficial: boolean;
  warningMessage?: string;
}

/**
 * Verifies whether a given contractId matches a known official ILN deployment.
 * Returns a result object containing status and formatted warning message if not official.
 *
 * @param contractId - The Soroban contract ID to verify.
 * @returns Verification result.
 */
export function verifyContractId(contractId: string): ContractIdVerificationResult {
  const isOfficial = KNOWN_OFFICIAL_CONTRACT_IDS.includes(contractId);
  if (!isOfficial) {
    const warningMessage = `[ILNSdk WARNING] Configured contractId "${contractId}" does not match any known official ILN deployment. If targeting a custom or self-hosted deployment, ignore this warning. Otherwise, verify contractId to prevent targeting an attacker-controlled contract per the SDK trust model.`;
    return {
      isOfficial: false,
      warningMessage,
    };
  }
  return { isOfficial: true };
}
