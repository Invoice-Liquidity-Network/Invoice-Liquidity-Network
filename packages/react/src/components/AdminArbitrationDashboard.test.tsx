import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminArbitrationDashboard } from './AdminArbitrationDashboard';
import { TestWrapper } from '../test/wrapper';
import { createMockILNClient, mockDisputeRecord } from '../test/mocks';

describe('AdminArbitrationDashboard', () => {
  it('renders dashboard title and dispute list', async () => {
    const mockClient = createMockILNClient({
      listDisputes: vi.fn().mockResolvedValue([mockDisputeRecord]),
    });

    render(
      <TestWrapper client={mockClient}>
        <AdminArbitrationDashboard adminAddress="GADMIN123" />
      </TestWrapper>
    );

    expect(screen.getByText('Dispute Resolution & Arbitration')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Invoice #101')).toBeInTheDocument();
    });
  });

  it('selects dispute and allows executing arbitration decision', async () => {
    const mockClient = createMockILNClient({
      listDisputes: vi.fn().mockResolvedValue([mockDisputeRecord]),
      resolveDispute: vi.fn().mockResolvedValue({ txHash: 'tx-resolve' }),
    });

    render(
      <TestWrapper client={mockClient}>
        <AdminArbitrationDashboard adminAddress="GADMIN123" />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Invoice #101')).toBeInTheDocument();
    });

    // Click on dispute row
    fireEvent.click(screen.getByTestId('dispute-row-101'));

    await waitFor(() => {
      expect(screen.getByTestId('arbitration-detail-panel')).toBeInTheDocument();
    });

    // Select decision
    const notesInput = screen.getByPlaceholderText(/Explain findings from evidence verification/i);
    fireEvent.change(notesInput, { target: { value: 'Verified deliverables in repository.' } });

    // Submit arbitration
    const executeBtn = screen.getByText('Execute Resolution On-Chain');
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(mockClient.resolveDispute).toHaveBeenCalledWith({
        admin: 'GADMIN123',
        invoiceId: 101n,
        decision: 'favor_freelancer',
        notes: 'Verified deliverables in repository.',
      });
    });
  });
});
