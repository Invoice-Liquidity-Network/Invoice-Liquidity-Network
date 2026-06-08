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
});