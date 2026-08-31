import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGovernanceProposal } from './useGovernanceProposal';
import { createMockILNClient, mockProposal } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

describe('useGovernanceProposal', () => {
  it('fetches proposal by id', async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useGovernanceProposal(1), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(mockProposal);
    expect(mockClient.getProposal).toHaveBeenCalledWith(1);
  });

  it('returns error on failure', async () => {
    const mockError = new Error('Proposal not found');
    const mockClient = createMockILNClient({
      getProposal: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(() => useGovernanceProposal(999), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toEqual(mockError);
  });

  it('skips fetch for invalid id', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useGovernanceProposal(0), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockClient.getProposal).not.toHaveBeenCalled();
  });

  it('derives timelock countdown from the latest ledger', async () => {
    const mockClient = createMockILNClient({
      getProposal: vi.fn().mockResolvedValue({
        ...mockProposal,
        status: 'Passed',
        etaLedger: 120,
      }),
      getLatestLedger: vi.fn().mockResolvedValue(110),
    });

    const { result } = renderHook(() => useGovernanceProposal(1), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.proposalStatus).toBe('Passed');
    expect(result.current.executionEtaLedger).toBe(120);
    expect(result.current.currentLedger).toBe(110);
    expect(result.current.timelockRemainingLedgers).toBe(10);
    expect(result.current.timeUntilExecutionMs).toBe(50_000);
    expect(result.current.canExecute).toBe(false);
  });
});
