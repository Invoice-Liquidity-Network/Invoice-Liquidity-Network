import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useContractStats } from './useContractStats';
import { createMockILNClient, mockContractStats } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

describe('useContractStats', () => {
  it('fetches contract stats', async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useContractStats(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(mockContractStats);
    expect(result.current.error).toBeNull();
  });

  it('handles errors', async () => {
    const mockError = new Error('Stats unavailable');
    const mockClient = createMockILNClient({
      getContractStats: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(() => useContractStats(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toEqual(mockError);
  });
});