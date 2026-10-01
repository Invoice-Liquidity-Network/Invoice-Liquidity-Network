import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createMockILNClient, mockDisputeRecord, mockDisputeAnalytics } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';
import {
  useDispute,
  useDisputeList,
  useFileDispute,
  useSubmitDisputeEvidence,
  useResolveDispute,
  useAutoResolveDispute,
  useDisputeAnalytics,
} from './useDispute';

describe('useDispute', () => {
  it('returns loading state initially and fetches dispute details', async () => {
    const mockClient = createMockILNClient({
      getDispute: vi.fn().mockResolvedValue(mockDisputeRecord),
    });
    const { result } = renderHook(() => useDispute(101n), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isLoading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockDisputeRecord);
    expect(mockClient.getDispute).toHaveBeenCalledWith(101n);
  });

  it('does not fetch when invoiceId is undefined', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useDispute(undefined), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockClient.getDispute).not.toHaveBeenCalled();
  });
});

describe('useDisputeList', () => {
  it('fetches disputes list with filter', async () => {
    const mockClient = createMockILNClient({
      listDisputes: vi.fn().mockResolvedValue([mockDisputeRecord]),
    });
    const { result } = renderHook(() => useDisputeList('Pending'), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toHaveLength(1);
    expect(mockClient.listDisputes).toHaveBeenCalledWith({ status: 'Pending' });
  });
});

describe('useFileDispute mutation', () => {
  it('calls client.disputeInvoice', async () => {
    const mockClient = createMockILNClient({
      disputeInvoice: vi.fn().mockResolvedValue({ txHash: 'tx-hash-1' }),
    });
    const { result } = renderHook(() => useFileDispute(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.fileDispute({
        invoiceId: 101n,
        reasonCategory: 'quality',
        evidenceCid: 'ipfs://bafy123',
        reasonDescription: 'Quality issue',
      });
    });

    expect(mockClient.disputeInvoice).toHaveBeenCalledWith({
      invoiceId: 101n,
      reasonCategory: 'quality',
      evidenceCid: 'ipfs://bafy123',
      reasonDescription: 'Quality issue',
    });
  });
});

describe('useSubmitDisputeEvidence mutation', () => {
  it('calls client.submitDisputeEvidence', async () => {
    const mockClient = createMockILNClient({
      submitDisputeEvidence: vi.fn().mockResolvedValue({ txHash: 'tx-hash-2' }),
    });
    const { result } = renderHook(() => useSubmitDisputeEvidence(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.submitEvidence({
        invoiceId: 101n,
        evidenceCid: 'ipfs://bafy456',
        description: 'Additional proof',
      });
    });

    expect(mockClient.submitDisputeEvidence).toHaveBeenCalledWith({
      invoiceId: 101n,
      evidenceCid: 'ipfs://bafy456',
      description: 'Additional proof',
    });
  });
});

describe('useResolveDispute mutation', () => {
  it('calls client.resolveDispute with decision and notes', async () => {
    const mockClient = createMockILNClient({
      resolveDispute: vi.fn().mockResolvedValue({ txHash: 'tx-hash-3' }),
    });
    const { result } = renderHook(() => useResolveDispute(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.resolveDispute({
        admin: 'GADMIN123',
        invoiceId: 101n,
        decision: 'favor_freelancer',
        notes: 'Deliverables verified',
      });
    });

    expect(mockClient.resolveDispute).toHaveBeenCalledWith({
      admin: 'GADMIN123',
      invoiceId: 101n,
      decision: 'favor_freelancer',
      notes: 'Deliverables verified',
    });
  });
});

describe('useAutoResolveDispute mutation', () => {
  it('calls client.autoResolveDispute', async () => {
    const mockClient = createMockILNClient({
      autoResolveDispute: vi.fn().mockResolvedValue({ txHash: 'tx-hash-4' }),
    });
    const { result } = renderHook(() => useAutoResolveDispute(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.autoResolveDispute({
        invoiceId: 101n,
      });
    });

    expect(mockClient.autoResolveDispute).toHaveBeenCalledWith({
      invoiceId: 101n,
    });
  });
});

describe('useDisputeAnalytics', () => {
  it('fetches dispute analytics data', async () => {
    const mockClient = createMockILNClient({
      getDisputeAnalytics: vi.fn().mockResolvedValue(mockDisputeAnalytics),
    });
    const { result } = renderHook(() => useDisputeAnalytics(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockDisputeAnalytics);
    expect(mockClient.getDisputeAnalytics).toHaveBeenCalled();
  });
});
