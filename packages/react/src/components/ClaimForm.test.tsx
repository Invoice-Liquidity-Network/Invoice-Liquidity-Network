import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMockILNClient, mockLPCoverage } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';
import { ClaimForm } from './ClaimForm';

const LP_ADDRESS = 'GLPADDR00000000000000000000000000000000000000000000000';

async function renderForm(overrides: Record<string, unknown> = {}) {
  const mockClient = createMockILNClient({
    getLPCoverage: vi.fn().mockResolvedValue(mockLPCoverage),
    getInvoicesByIssuer: vi.fn().mockResolvedValue([
      { id: 42, payer: 'GPAYER_A', amount: 5_000_000_000n, status: 'Defaulted' },
      { id: 43, payer: 'GPAYER_B', amount: 3_000_000_000n, status: 'Defaulted' },
      { id: 44, payer: 'GPAYER_C', amount: 2_000_000_000n, status: 'Paid' },
    ]),
    submitClaim: vi.fn().mockResolvedValue(3n),
    ...overrides,
  });
  return render(
    <TestWrapper client={mockClient}>
      <ClaimForm lp={LP_ADDRESS} />
    </TestWrapper>,
  );
}

describe('ClaimForm', () => {
  it('renders the form title', async () => {
    await renderForm();
    expect(screen.getByText('File a Claim')).toBeTruthy();
    expect(screen.getByText('Submit Insurance Claim')).toBeTruthy();
  });

  it('shows coverage info when enrolled', async () => {
    await renderForm();
    await vi.waitFor(() => {
      expect(screen.getByText(/coverage/)).toBeTruthy();
    });
  });

  it('shows defaulted invoice dropdown', async () => {
    await renderForm();
    await vi.waitFor(() => {
      expect(screen.getByText(/Select a defaulted invoice/)).toBeTruthy();
    });
  });

  it('submits claim successfully', async () => {
    const onSuccess = vi.fn();
    const submitMock = vi.fn().mockResolvedValue(3n);
    await renderForm({ submitClaim: submitMock });

    await vi.waitFor(() => {
      expect(screen.getByText(/Select a defaulted invoice/)).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '42' } });
    fireEvent.change(screen.getByPlaceholderText(/Describe why this claim/), { target: { value: 'The payer did not settle by the due date despite multiple reminders.' } });
    fireEvent.click(screen.getByText('Submit Claim'));

    await vi.waitFor(() => {
      expect(screen.getByText(/Claim #3 submitted/)).toBeTruthy();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows error on submission failure', async () => {
    await renderForm({
      submitClaim: vi.fn().mockRejectedValue(new Error('Insufficient coverage')),
    });

    await vi.waitFor(() => {
      expect(screen.getByText(/Select a defaulted invoice/)).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '42' } });
    fireEvent.change(screen.getByPlaceholderText(/Describe why this claim/), { target: { value: 'The payer defaulted on invoice payment.' } });
    fireEvent.click(screen.getByText('Submit Claim'));

    await vi.waitFor(() => {
      expect(screen.getByText('Insufficient coverage')).toBeTruthy();
    });
  });

  it('disables submit button when no defaulted invoice selected', async () => {
    await renderForm();
    await vi.waitFor(() => {
      const button = screen.getByText('Submit Claim') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });
  });

  it('shows eligibility warning when not enrolled', async () => {
    const mockClient = createMockILNClient({
      getLPCoverage: vi.fn().mockResolvedValue(null),
      getInvoices: vi.fn().mockResolvedValue([]),
      submitClaim: vi.fn(),
    });
    render(
      <TestWrapper client={mockClient}>
        <ClaimForm lp={LP_ADDRESS} />
      </TestWrapper>,
    );
    await vi.waitFor(() => {
      expect(screen.getByText(/must enroll/)).toBeTruthy();
    });
  });
});
