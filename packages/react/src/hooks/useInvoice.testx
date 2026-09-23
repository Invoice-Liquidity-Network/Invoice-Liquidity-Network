import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useInvoice } from './useInvoice';
import { createMockILNClient, mockInvoice } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

describe('useInvoice', () => {
  it('returns loading state initially', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useInvoice(42), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('fetches and returns invoice data', async () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useInvoice(42), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(mockInvoice);
    expect(result.current.error).toBeNull();
    expect(mockClient.getInvoice).toHaveBeenCalledWith(42);
  });

  it('returns error when fetch fails', async () => {
    const mockError = new Error('Invoice not found');
    const mockClient = createMockILNClient({
      getInvoice: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(() => useInvoice(999), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toEqual(mockError);
  });

  it('does not fetch when id is 0 or negative', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useInvoice(0), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockClient.getInvoice).not.toHaveBeenCalled();
  });

  it('refetches when id changes', async () => {
    const mockClient = createMockILNClient();
    const { result, rerender } = renderHook((props: { id: number }) => useInvoice(props.id), {
      initialProps: { id: 42 },
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockClient.getInvoice).toHaveBeenCalledWith(42);

    rerender({ id: 43 });
    await waitFor(() => expect(mockClient.getInvoice).toHaveBeenCalledWith(43));
  });
});