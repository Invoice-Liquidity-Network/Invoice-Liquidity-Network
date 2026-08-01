import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMockILNClient, mockLPCoverage } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';
import { InsurancePoolPanel } from './InsurancePoolPanel';

const LP_ADDRESS = 'GLPADDR00000000000000000000000000000000000000000000000';

async function renderPanel(overrides: Record<string, unknown> = {}) {
  const mockClient = createMockILNClient({
    getLPCoverage: vi.fn().mockResolvedValue(mockLPCoverage),
    getPoolBalance: vi.fn().mockResolvedValue({ totalPremiums: 10_000_000_000n, totalPayouts: 3_000_000_000n, reserveBalance: 7_000_000_000n, enrolledLps: 5, activeClaims: 3, pendingClaims: 2, approvedClaims: 1, rejectedClaims: 0 }),
    getInvoicesByStatus: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
  return render(
    <TestWrapper client={mockClient}>
      <InsurancePoolPanel address={LP_ADDRESS} />
    </TestWrapper>,
  );
}

describe('InsurancePoolPanel', () => {
  it('renders the panel title', async () => {
    await renderPanel();
    expect(screen.getByText('Insurance Pool')).toBeTruthy();
    expect(screen.getByText('LP Coverage & Claims')).toBeTruthy();
  });

  it('shows coverage stats when enrolled', async () => {
    await renderPanel();
    await vi.waitFor(() => {
      expect(screen.getByText('Coverage Amount')).toBeTruthy();
    });
  });

  it('shows active claims count', async () => {
    await renderPanel();
    await vi.waitFor(() => {
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows enroll button when not enrolled', async () => {
    const mockClient = createMockILNClient({
      getLPCoverage: vi.fn().mockResolvedValue(null),
      getPoolBalance: vi.fn().mockResolvedValue(null),
      getInvoicesByStatus: vi.fn().mockResolvedValue([]),
    });
    render(
      <TestWrapper client={mockClient}>
        <InsurancePoolPanel address={LP_ADDRESS} />
      </TestWrapper>,
    );
    await vi.waitFor(() => {
      expect(screen.getByText('Enroll Now')).toBeTruthy();
    });
  });

  it('shows error state on coverage fetch failure', async () => {
    await renderPanel({
      getLPCoverage: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    await vi.waitFor(() => {
      expect(screen.getByText(/Failed to load coverage/)).toBeTruthy();
    });
  });

  it('displays deposit premium button when enrolled', async () => {
    await renderPanel();
    await vi.waitFor(() => {
      expect(screen.getByText('Deposit Premium')).toBeTruthy();
    });
  });
});
