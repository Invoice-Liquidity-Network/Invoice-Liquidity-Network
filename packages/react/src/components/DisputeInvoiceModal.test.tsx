import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisputeInvoiceModal } from './DisputeInvoiceModal';
import { TestWrapper } from '../test/wrapper';
import { createMockILNClient } from '../test/mocks';

describe('DisputeInvoiceModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    invoiceId: 101n,
    payerAddress: 'GDHK...PAYER',
    onSuccess: vi.fn(),
  };

  it('renders modal when isOpen is true', () => {
    const mockClient = createMockILNClient();
    render(
      <TestWrapper client={mockClient}>
        <DisputeInvoiceModal {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText('Dispute Invoice #101')).toBeInTheDocument();
    expect(screen.getByText('Quality of Work')).toBeInTheDocument();
    expect(screen.getByText('Late Delivery / Timing')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    const mockClient = createMockILNClient();
    render(
      <TestWrapper client={mockClient}>
        <DisputeInvoiceModal {...defaultProps} isOpen={false} />
      </TestWrapper>
    );

    expect(screen.queryByText('Dispute Invoice #101')).not.toBeInTheDocument();
  });

  it('advances to consequence confirmation step and submits dispute', async () => {
    const mockClient = createMockILNClient({
      disputeInvoice: vi.fn().mockResolvedValue({ txHash: 'tx-123' }),
    });

    render(
      <TestWrapper client={mockClient}>
        <DisputeInvoiceModal {...defaultProps} />
      </TestWrapper>
    );

    // Fill form
    const descInput = screen.getByPlaceholderText(/Explain why this invoice is disputed/i);
    fireEvent.change(descInput, { target: { value: 'Defective deliverables delivered.' } });

    // Click proceed
    const proceedBtn = screen.getByText(/Review Dispute Consequences/i);
    fireEvent.click(proceedBtn);

    // Should show confirmation step
    await waitFor(() => {
      expect(screen.getByText(/Consequences of Filing a Formal Dispute/i)).toBeInTheDocument();
    });

    // Confirm submit
    const submitBtn = screen.getByText('Confirm & File Dispute');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockClient.disputeInvoice).toHaveBeenCalled();
      expect(defaultProps.onSuccess).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });
});
