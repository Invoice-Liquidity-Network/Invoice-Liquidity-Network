import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useILNClient } from '../context';

const insuranceKeys = {
  all: ['insurance'] as const,
  coverage: (address: string) => ['insurance', 'coverage', address] as const,
  poolBalance: () => ['insurance', 'poolBalance'] as const,
  claim: (id: bigint | string) => ['insurance', 'claim', String(id)] as const,
  claims: (status?: string) => ['insurance', 'claims', status ?? 'all'] as const,
};

export interface UseLPCoverageResult {
  data: import('@invoice-liquidity/sdk').LPCoverage | null | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useLPCoverage(address: string): UseLPCoverageResult {
  const client = useILNClient();
  const { data, isLoading, error } = useQuery({
    queryKey: insuranceKeys.coverage(address),
    queryFn: () =>
      (client as unknown as { getLPCoverage(a: string): Promise<import('@invoice-liquidity/sdk').LPCoverage | null> })
        .getLPCoverage(address),
    enabled: !!address,
    staleTime: 30_000,
  });
  return { data, isLoading, error: error instanceof Error ? error : null };
}

export interface UsePoolBalanceResult {
  data: import('@invoice-liquidity/sdk').PoolBalance | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function usePoolBalance(): UsePoolBalanceResult {
  const client = useILNClient();
  const { data, isLoading, error } = useQuery({
    queryKey: insuranceKeys.poolBalance(),
    queryFn: () =>
      (client as unknown as { getPoolBalance(): Promise<import('@invoice-liquidity/sdk').PoolBalance> })
        .getPoolBalance(),
    staleTime: 15_000,
  });
  return { data, isLoading, error: error instanceof Error ? error : null };
}

export interface UseClaimResult {
  data: import('@invoice-liquidity/sdk').InsuranceClaim | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useClaim(claimId: bigint | undefined): UseClaimResult {
  const client = useILNClient();
  const { data, isLoading, error } = useQuery({
    queryKey: insuranceKeys.claim(claimId ?? 0n),
    queryFn: () =>
      (client as unknown as { getClaim(id: bigint): Promise<import('@invoice-liquidity/sdk').InsuranceClaim> })
        .getClaim(claimId!),
    enabled: claimId != null,
    staleTime: 10_000,
  });
  return { data, isLoading, error: error instanceof Error ? error : null };
}

export interface UseClaimsListResult {
  data: import('@invoice-liquidity/sdk').InsuranceClaim[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useClaimsList(statusFilter?: string): UseClaimsListResult {
  const client = useILNClient();
  const { data, isLoading, error } = useQuery({
    queryKey: insuranceKeys.claims(statusFilter),
    queryFn: () =>
      (client as unknown as {
        listClaims(s?: string, p?: number, ps?: number): Promise<import('@invoice-liquidity/sdk').InsuranceClaim[]>
      }).listClaims(statusFilter, 0, 50),
    staleTime: 10_000,
  });
  return { data, isLoading, error: error instanceof Error ? error : null };
}

export interface UseEnrollResult {
  enroll: (params: import('@invoice-liquidity/sdk').EnrollParams) => Promise<void>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

export function useEnroll(): UseEnrollResult {
  const client = useILNClient();
  const queryClient = useQueryClient();
  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (params: import('@invoice-liquidity/sdk').EnrollParams): Promise<void> =>
      (client as unknown as { enroll(p: import('@invoice-liquidity/sdk').EnrollParams): Promise<void> })
        .enroll(params),
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: insuranceKeys.coverage(params.lp) });
      queryClient.invalidateQueries({ queryKey: insuranceKeys.poolBalance() });
    },
  });
  return { enroll: mutateAsync, isPending, error: error instanceof Error ? error : null, reset };
}

export interface UseDepositPremiumResult {
  depositPremium: (params: import('@invoice-liquidity/sdk').DepositPremiumParams) => Promise<void>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

export function useDepositPremium(): UseDepositPremiumResult {
  const client = useILNClient();
  const queryClient = useQueryClient();
  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (params: import('@invoice-liquidity/sdk').DepositPremiumParams): Promise<void> =>
      (client as unknown as { depositPremium(p: import('@invoice-liquidity/sdk').DepositPremiumParams): Promise<void> })
        .depositPremium(params),
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: insuranceKeys.coverage(params.lp) });
      queryClient.invalidateQueries({ queryKey: insuranceKeys.poolBalance() });
    },
  });
  return { depositPremium: mutateAsync, isPending, error: error instanceof Error ? error : null, reset };
}

export interface UseSubmitClaimResult {
  submitClaim: (params: import('@invoice-liquidity/sdk').SubmitClaimParams) => Promise<bigint>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

export function useSubmitClaim(): UseSubmitClaimResult {
  const client = useILNClient();
  const queryClient = useQueryClient();
  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (params: import('@invoice-liquidity/sdk').SubmitClaimParams): Promise<bigint> =>
      (client as unknown as { submitClaim(p: import('@invoice-liquidity/sdk').SubmitClaimParams): Promise<bigint> })
        .submitClaim(params),
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: insuranceKeys.coverage(params.lp) });
      queryClient.invalidateQueries({ queryKey: insuranceKeys.claims() });
      queryClient.invalidateQueries({ queryKey: insuranceKeys.poolBalance() });
    },
  });
  return { submitClaim: mutateAsync, isPending, error: error instanceof Error ? error : null, reset };
}

export interface UseReviewClaimResult {
  reviewClaim: (params: import('@invoice-liquidity/sdk').ReviewClaimParams) => Promise<void>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

export function useReviewClaim(): UseReviewClaimResult {
  const client = useILNClient();
  const queryClient = useQueryClient();
  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (params: import('@invoice-liquidity/sdk').ReviewClaimParams): Promise<void> =>
      (client as unknown as { reviewClaim(p: import('@invoice-liquidity/sdk').ReviewClaimParams): Promise<void> })
        .reviewClaim(params),
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: insuranceKeys.claim(params.claimId) });
      queryClient.invalidateQueries({ queryKey: insuranceKeys.claims() });
      queryClient.invalidateQueries({ queryKey: insuranceKeys.poolBalance() });
    },
  });
  return { reviewClaim: mutateAsync, isPending, error: error instanceof Error ? error : null, reset };
}
