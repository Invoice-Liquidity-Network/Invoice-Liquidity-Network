import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAuctionRate, deriveAuctionRateState } from './useAuctionRate';
import { createMockILNClient } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

const auctionInvoice = {
  id: 42,
  issuer: 'GISSUER',
  payer: 'GPAYER',
  amount: 100_0000000,
  status: 'Pending',
  startDiscountBps: 100,
  maxDiscountBps: 500,
  auctionStepBps: 50,
  stepIntervalSeconds: 60,
  submittedAt: 1_000,
  dueDate: 2_000,
};

describe('deriveAuctionRateState', () => {
  it('calculates the current Dutch auction discount from RFC fields', () => {
    const state = deriveAuctionRateState(auctionInvoice as any, 1_125);

    expect(state.hasAuction).toBe(true);
    expect(state.currentDiscountBps).toBe(200);
    expect(state.secondsUntilNextIncrement).toBe(55);
    expect(state.progressToNextStep).toBeCloseTo(5 / 60);
  });

  it('caps the discount at the auction maximum', () => {
    const state = deriveAuctionRateState(auctionInvoice as any, 2_000);

    expect(state.currentDiscountBps).toBe(500);
    expect(state.nextIncrementAt).toBeNull();
    expect(state.isExpired).toBe(true);
  });
});

describe('useAuctionRate', () => {
  it('fetches invoice state and exposes the live rate', async () => {
    const mockClient = createMockILNClient({
      getInvoice: vi.fn().mockResolvedValue(auctionInvoice),
    });

    const { result } = renderHook(
      () => useAuctionRate(42, { now: () => 1_125, pollIntervalMs: 60_000 }),
      { wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper> },
    );

    await waitFor(() => expect(result.current.currentDiscountBps).toBe(200));
    expect(mockClient.getInvoice).toHaveBeenCalledWith(42);
  });

  it('uses getCurrentDiscount when a client exposes a dedicated live-rate method', async () => {
    const mockClient = createMockILNClient({
      getCurrentDiscount: vi.fn().mockResolvedValue(375),
    });

    const { result } = renderHook(
      () => useAuctionRate(42, {
        initialInvoice: auctionInvoice as any,
        now: () => 1_125,
        pollIntervalMs: 60_000,
      }),
      { wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper> },
    );

    await waitFor(() => expect(result.current.currentDiscountBps).toBe(375));
    expect((mockClient as any).getCurrentDiscount).toHaveBeenCalledWith(42);
  });
});
