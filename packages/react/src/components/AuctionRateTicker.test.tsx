import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuctionRateTicker } from './AuctionRateTicker';
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
  submittedAt: Math.floor(Date.now() / 1000) - 125,
  dueDate: Math.floor(Date.now() / 1000) + 3_600,
};

describe('AuctionRateTicker', () => {
  it('renders live Dutch auction rate details', async () => {
    const mockClient = createMockILNClient({
      getInvoice: vi.fn().mockResolvedValue(auctionInvoice),
    });

    render(
      <TestWrapper client={mockClient}>
        <AuctionRateTicker
          invoiceId={42}
          invoice={auctionInvoice as any}
          funder="GLP"
          showChart={false}
        />
      </TestWrapper>,
    );

    expect(await screen.findByText('Dutch Auction')).toBeTruthy();
    expect(screen.getByText('Fund at Current Rate')).toBeTruthy();
    expect(screen.getByText('Starts at')).toBeTruthy();
    expect(screen.getByText('Max rate')).toBeTruthy();
  });

  it('funds with the displayed discount rate', async () => {
    const fundInvoice = vi.fn().mockResolvedValue(undefined);
    const mockClient = createMockILNClient({
      getInvoice: vi.fn().mockResolvedValue(auctionInvoice),
      fundInvoice,
    });

    render(
      <TestWrapper client={mockClient}>
        <AuctionRateTicker
          invoiceId={42}
          invoice={auctionInvoice as any}
          funder="GLP"
          showChart={false}
        />
      </TestWrapper>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Fund at Current Rate' }));

    await waitFor(() => {
      expect(fundInvoice).toHaveBeenCalledWith(expect.objectContaining({
        invoiceId: 42,
        funder: 'GLP',
        expectedDiscountBps: expect.any(Number),
      }));
    });
  });
});
