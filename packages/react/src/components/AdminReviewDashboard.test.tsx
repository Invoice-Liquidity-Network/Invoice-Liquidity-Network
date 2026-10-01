import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMockILNClient, mockInsuranceClaim } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';
import { AdminReviewDashboard } from './AdminReviewDashboard';

const ADMIN_ADDRESS = 'GADMIN0000000000000000000000000000000000000000000000000';

async function renderDashboard(overrides: Record<string, unknown> = {}) {
  const mockClient = createMockILNClient({
    getPoolBalance: vi.fn().mockResolvedValue({
      totalPremiums: 10_000_000_000n,
      totalPayouts: 3_000_000_000n,
      reserveBalance: 7_000_000_000n,
      enrolledLps: 5,
      activeClaims: 3,
      pendingClaims: 2,
      approvedClaims: 1,
      rejectedClaims: 0,
    }),
    listClaims: vi.fn().mockResolvedValue([
      { ...mockInsuranceClaim, id: 1n, status: 'Pending' },
      {
        ...mockInsuranceClaim,
        id: 2n,
        status: 'Approved',
        payoutAmount: 5_000_000_000n,
        reviewedAt: 1735862400,
        reviewer: ADMIN_ADDRESS,
      },
    ]),
    ...overrides,
  });
  return render(
    <TestWrapper client={mockClient}>
      <AdminReviewDashboard adminAddress={ADMIN_ADDRESS} />
    </TestWrapper>
  );
}

describe('AdminReviewDashboard', () => {
  it('renders the dashboard title', async () => {
    await renderDashboard();
    expect(screen.getByText('Admin Review')).toBeTruthy();
    expect(screen.getByText('Claims Review Dashboard')).toBeTruthy();
  });

  it('shows pool balance stats', async () => {
    await renderDashboard();
    await vi.waitFor(() => {
      expect(screen.getByText('Pool Reserve')).toBeTruthy();
      expect(screen.getByText('$700.00')).toBeTruthy();
    });
  });

  it('renders claims with different statuses', async () => {
    await renderDashboard();
    await vi.waitFor(() => {
      expect(screen.getByText(/Claim #1/)).toBeTruthy();
      expect(screen.getByText(/Claim #2/)).toBeTruthy();
    });
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1);
  });

  it('shows approve and reject buttons for pending claims', async () => {
    await renderDashboard();
    await vi.waitFor(() => {
      const approveButtons = screen.getAllByText('Approve');
      const rejectButtons = screen.getAllByText('Reject');
      expect(approveButtons.length).toBeGreaterThanOrEqual(1);
      expect(rejectButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows empty state when no claims', async () => {
    await renderDashboard({
      listClaims: vi.fn().mockResolvedValue([]),
    });
    await vi.waitFor(() => {
      expect(screen.getByText(/no.*claims/i)).toBeTruthy();
    });
  });

  it('shows error state on list failure', async () => {
    await renderDashboard({
      listClaims: vi.fn().mockRejectedValue(new Error('RPC unavailable')),
    });
    await vi.waitFor(() => {
      expect(screen.getByText(/Failed to load claims/)).toBeTruthy();
    });
  });

  it('filters claims by status tab', async () => {
    const listClaimsMock = vi
      .fn()
      .mockResolvedValue([{ ...mockInsuranceClaim, id: 1n, status: 'Pending' }]);
    await renderDashboard({ listClaims: listClaimsMock });
    await vi.waitFor(() => {
      expect(screen.getByText('Pending')).toBeTruthy();
    });
    const pendingTab = screen.getAllByText('Pending')[0];
    fireEvent.click(pendingTab);
    await vi.waitFor(() => {
      expect(listClaimsMock).toHaveBeenCalledWith('Pending', 0, 50);
    });
  });
});
