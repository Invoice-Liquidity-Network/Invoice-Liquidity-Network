import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  createMockILNClient,
  mockLPCoverage,
  mockPoolBalance,
  mockInsuranceClaim,
} from '../test/mocks';
import { TestWrapper } from '../test/wrapper';
import {
  useLPCoverage,
  usePoolBalance,
  useClaim,
  useClaimsList,
  useEnroll,
  useDepositPremium,
  useSubmitClaim,
  useReviewClaim,
} from './useInsurance';

const LP_ADDRESS = 'GLPADDR00000000000000000000000000000000000000000000000';
const ADMIN_ADDRESS = 'GADMIN0000000000000000000000000000000000000000000000000';

describe('useLPCoverage', () => {
  it('returns idle state initially', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useLPCoverage(LP_ADDRESS), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('fetches LP coverage data', async () => {
    const mockClient = createMockILNClient({
      getLPCoverage: vi.fn().mockResolvedValue(mockLPCoverage),
    });
    const { result } = renderHook(() => useLPCoverage(LP_ADDRESS), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual(mockLPCoverage);
    expect(mockClient.getLPCoverage).toHaveBeenCalledWith(LP_ADDRESS);
  });

  it('handles null coverage (not enrolled)', async () => {
    const mockClient = createMockILNClient({
      getLPCoverage: vi.fn().mockResolvedValue(null),
    });
    const { result } = renderHook(() => useLPCoverage(LP_ADDRESS), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toBeNull();
  });

  it('surfaces error on failure', async () => {
    const testError = new Error('RPC error');
    const mockClient = createMockILNClient({
      getLPCoverage: vi.fn().mockRejectedValue(testError),
    });
    const { result } = renderHook(() => useLPCoverage(LP_ADDRESS), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toEqual(testError);
  });
});

describe('usePoolBalance', () => {
  it('fetches pool balance', async () => {
    const mockClient = createMockILNClient({
      getPoolBalance: vi.fn().mockResolvedValue(mockPoolBalance),
    });
    const { result } = renderHook(() => usePoolBalance(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual(mockPoolBalance);
  });
});

describe('useClaim', () => {
  it('fetches a specific claim', async () => {
    const mockClient = createMockILNClient({
      getClaim: vi.fn().mockResolvedValue(mockInsuranceClaim),
    });
    const { result } = renderHook(() => useClaim(1n), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual(mockInsuranceClaim);
    expect(mockClient.getClaim).toHaveBeenCalledWith(1n);
  });

  it('does not fetch when claimId is undefined', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useClaim(undefined), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});

describe('useClaimsList', () => {
  it('fetches all claims without filter', async () => {
    const mockClient = createMockILNClient({
      listClaims: vi.fn().mockResolvedValue([mockInsuranceClaim]),
    });
    const { result } = renderHook(() => useClaimsList(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toHaveLength(1);
  });

  it('fetches pending claims with filter', async () => {
    const mockClient = createMockILNClient({
      listClaims: vi.fn().mockResolvedValue([mockInsuranceClaim]),
    });
    const { result } = renderHook(() => useClaimsList('Pending'), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(mockClient.listClaims).toHaveBeenCalledWith('Pending', 0, 50);
  });
});

describe('useEnroll', () => {
  it('calls client.enroll and invalidates queries', async () => {
    const mockClient = createMockILNClient({
      enroll: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useEnroll(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    const params = { lp: LP_ADDRESS, coverageAmount: 1_000_000_000n, premiumRateBps: 500 };
    await act(async () => {
      await result.current.enroll(params);
    });
    expect(mockClient.enroll).toHaveBeenCalledWith(params);
  });

  it('surfaces enroll error', async () => {
    const testError = new Error('LP already enrolled');
    const mockClient = createMockILNClient({
      enroll: vi.fn().mockRejectedValue(testError),
    });
    const { result } = renderHook(() => useEnroll(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    await act(async () => {
      await result.current
        .enroll({ lp: LP_ADDRESS, coverageAmount: 1_000_000_000n, premiumRateBps: 500 })
        .catch(() => {});
    });
    expect(result.current.error).toEqual(testError);
  });
});

describe('useDepositPremium', () => {
  it('calls client.depositPremium', async () => {
    const mockClient = createMockILNClient({
      depositPremium: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useDepositPremium(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    const params = { lp: LP_ADDRESS, amount: 100_000_000n };
    await act(async () => {
      await result.current.depositPremium(params);
    });
    expect(mockClient.depositPremium).toHaveBeenCalledWith(params);
  });
});

describe('useSubmitClaim', () => {
  it('calls client.submitClaim and returns claim ID', async () => {
    const mockClient = createMockILNClient({
      submitClaim: vi.fn().mockResolvedValue(5n),
    });
    const { result } = renderHook(() => useSubmitClaim(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    let claimId: bigint | undefined;
    await act(async () => {
      claimId = await result.current.submitClaim({
        lp: LP_ADDRESS,
        invoiceId: 42n,
        reason: 'defaulted',
      });
    });
    expect(claimId).toBe(5n);
    expect(mockClient.submitClaim).toHaveBeenCalledWith({
      lp: LP_ADDRESS,
      invoiceId: 42n,
      reason: 'defaulted',
    });
  });
});

describe('useReviewClaim', () => {
  it('calls client.reviewClaim with approve=true', async () => {
    const mockClient = createMockILNClient({
      reviewClaim: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useReviewClaim(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    await act(async () => {
      await result.current.reviewClaim({ reviewer: ADMIN_ADDRESS, claimId: 1n, approve: true });
    });
    expect(mockClient.reviewClaim).toHaveBeenCalledWith({
      reviewer: ADMIN_ADDRESS,
      claimId: 1n,
      approve: true,
    });
  });

  it('calls client.reviewClaim with rejection reason', async () => {
    const mockClient = createMockILNClient({
      reviewClaim: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useReviewClaim(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    await act(async () => {
      await result.current.reviewClaim({
        reviewer: ADMIN_ADDRESS,
        claimId: 1n,
        approve: false,
        reason: 'insufficient evidence',
      });
    });
    expect(mockClient.reviewClaim).toHaveBeenCalledWith({
      reviewer: ADMIN_ADDRESS,
      claimId: 1n,
      approve: false,
      reason: 'insufficient evidence',
    });
  });
});
