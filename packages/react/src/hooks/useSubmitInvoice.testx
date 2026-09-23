import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSubmitInvoice } from './useSubmitInvoice';
import type { SubmitInvoiceParams } from './useSubmitInvoice';
import { createMockILNClient } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

const validParams: SubmitInvoiceParams = {
  issuer: 'GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2',
  payer: 'GDELEGATE000000000000000000000000000000000000000000000001',
  amount: 100_0000000,
  discountRate: 300,
  dueDate: 1_800_000_000,
};

describe('useSubmitInvoice', () => {
  it('returns idle state initially', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('calls client.submitInvoice with the provided params', async () => {
    const mockClient = createMockILNClient({
      submitInvoice: vi.fn().mockResolvedValue(42),
    });

    const { result } = renderHook(() => useSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.submitInvoice(validParams);
    });

    expect(mockClient.submitInvoice).toHaveBeenCalledWith(validParams);
  });

  it('returns the invoice id from submitInvoice', async () => {
    const mockClient = createMockILNClient({
      submitInvoice: vi.fn().mockResolvedValue(99),
    });

    const { result } = renderHook(() => useSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    let returnedId: unknown;
    await act(async () => {
      returnedId = await result.current.submitInvoice(validParams);
    });

    expect(returnedId).toBe(99);
  });

  it('sets and surfaces error on failure', async () => {
    const mockError = new Error('Insufficient balance');
    const mockClient = createMockILNClient({
      submitInvoice: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(() => useSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.submitInvoice(validParams).catch(() => undefined);
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toEqual(mockError);
  });

  it('reset clears the error state', async () => {
    const mockClient = createMockILNClient({
      submitInvoice: vi.fn().mockRejectedValue(new Error('oops')),
    });

    const { result } = renderHook(() => useSubmitInvoice(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.submitInvoice(validParams).catch(() => undefined);
    });

    expect(result.current.error).not.toBeNull();

    act(() => { result.current.reset(); });

    expect(result.current.error).toBeNull();
  });
});
