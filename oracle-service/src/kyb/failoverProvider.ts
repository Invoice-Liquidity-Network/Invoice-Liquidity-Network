import type { KYBVerificationResult, VerificationProvider } from '../types';

export interface FailoverKYBProviderOptions {
  name?: string;
  primary: VerificationProvider;
  fallback: VerificationProvider;
  onFailover?: (error: unknown) => void;
}

/**
 * Failover KYB Verification Provider Adapter (#1238)
 *
 * Implements high-availability external KYB routing by attempting primary provider
 * and failing over to secondary provider upon transient network or 5xx failures,
 * while STRICTLY preserving enforcement (unverified entities remain rejected).
 */
export class FailoverKYBProvider implements VerificationProvider {
  public readonly name: string;
  public readonly isMock: boolean;
  private readonly primary: VerificationProvider;
  private readonly fallback: VerificationProvider;
  private readonly onFailover?: (error: unknown) => void;

  constructor(options: FailoverKYBProviderOptions) {
    this.name = options.name ?? `Failover(${options.primary.name}->${options.fallback.name})`;
    this.isMock = Boolean(options.primary.isMock && options.fallback.isMock);
    this.primary = options.primary;
    this.fallback = options.fallback;
    this.onFailover = options.onFailover;
  }

  public async verifyPayer(
    payerAddress: string,
    metadata?: Record<string, unknown>
  ): Promise<KYBVerificationResult> {
    try {
      const primaryResult = await this.primary.verifyPayer(payerAddress, metadata);
      return {
        ...primaryResult,
        rawDetails: {
          ...primaryResult.rawDetails,
          failoverAttempted: false,
          effectiveProvider: this.primary.name,
        },
      };
    } catch (primaryError) {
      if (this.onFailover) {
        this.onFailover(primaryError);
      }
      // Failover to secondary provider without weakening enforcement
      const fallbackResult = await this.fallback.verifyPayer(payerAddress, metadata);
      return {
        ...fallbackResult,
        rawDetails: {
          ...fallbackResult.rawDetails,
          failoverAttempted: true,
          effectiveProvider: this.fallback.name,
        },
      };
    }
  }
}
