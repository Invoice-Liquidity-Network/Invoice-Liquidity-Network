import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFundInvoice } from './useFundInvoice';
import type { FundInvoiceParams } from './useFundInvoice';
import { createMockILNClient } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';
import { ILNContext } from '../context/ILNContext';

const validParams: FundInvoiceParams = {
  invoiceId: 42,
  funder: 'GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2',
};

describe('useFundInvoice', () => {
  it('returns idle state initially', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useFundInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('calls client.fundInvoice with the provided params', async () => {
    const mockClient = createMockILNClient({
      fundInvoice: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useFundInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.fundInvoice(validParams);
    });

    expect(mockClient.fundInvoice).toHaveBeenCalledWith(validParams);
  });

  it('sets isPending to true while funding and false after', async () => {
    let resolve!: () => void;
    const fundPromise = new Promise<void>((res) => { resolve = res; });

    const mockClient = createMockILNClient({
      fundInvoice: vi.fn().mockReturnValue(fundPromise),
    });

    const { result } = renderHook(() => useFundInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isPending).toBe(false);

    act(() => { void result.current.fundInvoice(validParams); });
    expect(result.current.isPending).toBe(true);

    await act(async () => { resolve(); });
    expect(result.current.isPending).toBe(false);
  });

  it('sets error state on failure', async () => {
    const mockError = new Error('Not enough liquidity');
    const mockClient = createMockILNClient({
      fundInvoice: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(() => useFundInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.fundInvoice(validParams).catch(() => undefined);
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toEqual(mockError);
  });

  it('reset clears the error state', async () => {
    const mockClient = createMockILNClient({
      fundInvoice: vi.fn().mockRejectedValue(new Error('failed')),
    });

    const { result } = renderHook(() => useFundInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.fundInvoice(validParams).catch(() => undefined);
    });

    expect(result.current.error).not.toBeNull();

    act(() => { result.current.reset(); });

    expect(result.current.error).toBeNull();
  });

  it('rolls back optimistic update on error', async () => {
    const mockClient = createMockILNClient({
      fundInvoice: vi.fn().mockRejectedValue(new Error('tx failed')),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(['invoices', 'detail', 42], { id: 42, status: 'Pending' });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ILNContext.Provider value={mockClient as any}>{children}</ILNContext.Provider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useFundInvoice(), { wrapper });

    await act(async () => {
      await result.current.fundInvoice(validParams).catch(() => undefined);
    });

    expect(queryClient.getQueryData(['invoices', 'detail', 42])).toEqual({
      id: 42,
      status: 'Pending',
    });
  });

  it('succeeds and leaves error null', async () => {
    const mockClient = createMockILNClient({
      fundInvoice: vi.fn().mockResolvedValue(undefined),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(['invoices', 'detail', 42], { id: 42, status: 'Pending' });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ILNContext.Provider value={mockClient as any}>{children}</ILNContext.Provider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useFundInvoice(), { wrapper });

    await act(async () => {
      await result.current.fundInvoice(validParams);
    });

    expect(result.current.error).toBeNull();
    expect(mockClient.fundInvoice).toHaveBeenCalledWith(validParams);
  });
});
