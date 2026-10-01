import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useInvoiceList } from './useInvoiceList';
import { createMockILNClient, mockInvoiceList } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

describe('useInvoiceList', () => {
  it('fetches invoices by issuer role', async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(
      () => useInvoiceList('GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2', 'issuer'),
      {
        wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
      }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(mockInvoiceList);
    expect(mockClient.getInvoicesByIssuer).toHaveBeenCalled();
  });

  it('does not fetch with invalid address', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useInvoiceList('invalid', 'issuer'), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockClient.getInvoicesByIssuer).not.toHaveBeenCalled();
  });

  it('returns error on fetch failure', async () => {
    const mockError = new Error('Network error');
    const mockClient = createMockILNClient({
      getInvoicesByIssuer: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(
      () => useInvoiceList('GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2', 'issuer'),
      {
        wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
      }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toEqual(mockError);
  });
});