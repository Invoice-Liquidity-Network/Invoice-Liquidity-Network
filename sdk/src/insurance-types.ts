export interface LPCoverage {
  address: string;
  enrolledAt: number;
  coverageAmount: bigint;
  premiumRateBps: number;
  totalPremiumsPaid: bigint;
  activeClaims: number;
  totalClaims: number;
  claimsApproved: number;
  claimsRejected: number;
  totalPayoutReceived: bigint;
}

export interface InsuranceClaim {
  id: bigint;
  lp: string;
  invoiceId: bigint;
  invoiceAmount: bigint;
  reason: string;
  status: ClaimStatus;
  filedAt: number;
  reviewedAt: number | null;
  reviewer: string | null;
  rejectionReason: string | null;
  payoutAmount: bigint | null;
}

export type ClaimStatus = 'Pending' | 'Approved' | 'Rejected';

export interface EnrollParams {
  lp: string;
  coverageAmount: bigint;
  premiumRateBps: number;
}

export interface DepositPremiumParams {
  lp: string;
  amount: bigint;
}

export interface SubmitClaimParams {
  lp: string;
  invoiceId: bigint;
  reason: string;
}

export interface ReviewClaimParams {
  reviewer: string;
  claimId: bigint;
  approve: boolean;
  reason?: string;
}

export interface PoolBalance {
  totalPremiums: bigint;
  totalPayouts: bigint;
  reserveBalance: bigint;
  enrolledLps: number;
  activeClaims: number;
  pendingClaims: number;
  approvedClaims: number;
  rejectedClaims: number;
}

export interface CoverageInfo {
  coverage: LPCoverage | null;
  eligible: boolean;
  eligibleInvoices: number;
}
