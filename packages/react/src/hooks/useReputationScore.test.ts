import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useReputationScore } from './useReputationScore';
import { createMockILNClient, mockReputationScore } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

describe('useReputationScore', () => {
  it('fetches reputation score', async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(
      () => useReputationScore('GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2'),
      {
        wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
      }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(mockReputationScore);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch errors', async () => {
    const mockError = new Error('Reputation not found');
    const mockClient = createMockILNClient({
      getReputationScore: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(
      () => useReputationScore('GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2'),
      {
        wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
      }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toEqual(mockError);
  });

  it('skips fetch for invalid address', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useReputationScore('bad-address'), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockClient.getReputationScore).not.toHaveBeenCalled();
  });
});