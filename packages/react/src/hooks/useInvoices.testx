import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useInvoices } from './useInvoices';
import { createMockILNClient, mockInvoiceList } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

const VALID_ADDRESS = 'GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2';

describe('useInvoices', () => {
  it('returns loading state initially for a valid address', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useInvoices(VALID_ADDRESS), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('fetches invoices by issuer role by default', async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useInvoices(VALID_ADDRESS), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockClient.getInvoicesByIssuer).toHaveBeenCalledWith(VALID_ADDRESS);
    expect(result.current.data).toBeDefined();
  });

  it('returns correct pagination metadata', async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(
      () => useInvoices(VALID_ADDRESS, { role: 'issuer', page: 1, pageSize: 1 }),
      { wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper> },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(1);
    expect(result.current.totalCount).toBe(mockInvoiceList.length);
    expect(result.current.data?.length).toBe(1);
    expect(result.current.hasPreviousPage).toBe(false);
    expect(result.current.hasNextPage).toBe(mockInvoiceList.length > 1);
  });

  it('handles page 2 with correct slice', async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(
      () => useInvoices(VALID_ADDRESS, { page: 2, pageSize: 1 }),
      { wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper> },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.page).toBe(2);
    expect(result.current.hasPreviousPage).toBe(true);
  });

  it('does not fetch with invalid address', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useInvoices('invalid-address'), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockClient.getInvoicesByIssuer).not.toHaveBeenCalled();
  });

  it('returns error when fetch fails', async () => {
    const mockError = new Error('Network error');
    const mockClient = createMockILNClient({
      getInvoicesByIssuer: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(() => useInvoices(VALID_ADDRESS), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toEqual(mockError);
    expect(result.current.data).toBeUndefined();
  });
});
