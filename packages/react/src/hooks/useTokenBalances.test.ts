import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTokenBalances } from './useTokenBalances';
import { createMockILNClient, mockTokenBalances } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

describe('useTokenBalances', () => {
  it('fetches token balances', async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(
      () => useTokenBalances('GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2'),
      {
        wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
      }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(mockTokenBalances);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch errors', async () => {
    const mockError = new Error('Balance fetch failed');
    const mockClient = createMockILNClient({
      getTokenBalances: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(
      () => useTokenBalances('GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2'),
      {
        wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
      }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toEqual(mockError);
  });

  it('skips fetch for invalid address', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useTokenBalances(''), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockClient.getTokenBalances).not.toHaveBeenCalled();
  });
});