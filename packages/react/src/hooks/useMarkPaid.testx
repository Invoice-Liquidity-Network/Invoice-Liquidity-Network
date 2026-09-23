import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMarkPaid } from './useMarkPaid';
import type { MarkPaidParams } from './useMarkPaid';
import { createMockILNClient } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

const validParams: MarkPaidParams = { invoiceId: 42 };

describe('useMarkPaid', () => {
  it('returns idle state initially', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useMarkPaid(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('calls client.markPaid with the provided params', async () => {
    const mockClient = createMockILNClient({
      markPaid: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useMarkPaid(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.markPaid(validParams);
    });

    expect(mockClient.markPaid).toHaveBeenCalledWith(validParams);
  });

  it('sets and surfaces error on failure', async () => {
    const mockError = new Error('Invoice already paid');
    const mockClient = createMockILNClient({
      markPaid: vi.fn().mockRejectedValue(mockError),
    });

    const { result } = renderHook(() => useMarkPaid(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.markPaid(validParams).catch(() => undefined);
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toEqual(mockError);
  });

  it('reset clears the error state', async () => {
    const mockClient = createMockILNClient({
      markPaid: vi.fn().mockRejectedValue(new Error('oops')),
    });

    const { result } = renderHook(() => useMarkPaid(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.markPaid(validParams).catch(() => undefined);
    });

    expect(result.current.error).not.toBeNull();

    act(() => { result.current.reset(); });

    expect(result.current.error).toBeNull();
  });
});
