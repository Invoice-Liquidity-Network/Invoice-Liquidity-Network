import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ILNProvider } from '../context';

expect.extend(toHaveNoViolations);
import { TestWrapper } from '../test/wrapper';
import { createMockILNClient, mockLPCoverage, mockPoolBalance, mockInsuranceClaim, mockInvoiceList } from '../test/mocks';
import { InvoiceDashboard } from './InvoiceDashboard';
import { InvoiceCard } from './InvoiceCard';
import { BatchInvoiceForm } from './BatchInvoiceForm';
import { NotificationCenter } from './NotificationCenter';
import { InsurancePoolPanel } from './InsurancePoolPanel';
import { ClaimForm } from './ClaimForm';
import { AdminReviewDashboard } from './AdminReviewDashboard';
import { InsuranceAnalytics } from './InsuranceAnalytics';
import { LPRiskDashboard } from './LPRiskDashboard';
import { StatsCard } from './StatsCard';
import { StatusBadge } from './StatusBadge';
import { AddressDisplay } from './AddressDisplay';
import type { Invoice, LPPortfolio } from '@invoice-liquidity/sdk';

const LP_ADDRESS = 'GLPADDR00000000000000000000000000000000000000000000000';

const mockInvoice: Invoice = {
  id: 1,
  issuer: 'GISSUERADDR0000000000000000000000000000000000000000000000',
  payer: 'GPAYERADDR00000000000000000000000000000000000000000000000',
  amount: 100_0000000,
  discountRate: 300,
  dueDate: 1735689600,
  status: 'Funded',
  fundedBy: LP_ADDRESS,
  token: 'USDC',
} as unknown as Invoice;

const mockPortfolio: LPPortfolio = {
  address: LP_ADDRESS,
  totalInvested: 5000_0000000,
  totalYield: 150_0000000,
  activePositions: 5,
  completedPositions: 8,
  defaultedPositions: 1,
  avgReturn: 3.2,
} as unknown as LPPortfolio;

describe('InvoiceDashboard a11y', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <InvoiceDashboard websocketUrl="wss://example.com/ws" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('InvoiceCard a11y', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <TestWrapper><InvoiceCard invoice={mockInvoice} /></TestWrapper>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations when clickable', async () => {
    const { container } = render(
      <TestWrapper><InvoiceCard invoice={mockInvoice} onClick={vi.fn()} /></TestWrapper>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('BatchInvoiceForm a11y', () => {
  it('has no axe violations', async () => {
    const mockClient = createMockILNClient({
      submitBatch: vi.fn().mockResolvedValue({ results: [] }),
    });
    const { container } = render(
      <ILNProvider client={mockClient}>
        <BatchInvoiceForm freelancer={LP_ADDRESS} />
      </ILNProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('NotificationCenter a11y', () => {
  it('has no axe violations', async () => {
    const { container } = render(<NotificationCenter />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('InsurancePoolPanel a11y', () => {
  it('has no axe violations when enrolled', async () => {
    const mockClient = createMockILNClient({
      getLPCoverage: vi.fn().mockResolvedValue(mockLPCoverage),
      getPoolBalance: vi.fn().mockResolvedValue(mockPoolBalance),
    });
    const { container } = render(
      <TestWrapper client={mockClient}>
        <InsurancePoolPanel address={LP_ADDRESS} />
      </TestWrapper>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('ClaimForm a11y', () => {
  it('has no axe violations when enrolled', async () => {
    const mockClient = createMockILNClient({
      getLPCoverage: vi.fn().mockResolvedValue(mockLPCoverage),
      getInvoicesByIssuer: vi.fn().mockResolvedValue([
        { id: 42, payer: 'GPAYER_A', amount: 5_000_000_000n, status: 'Defaulted' },
      ]),
      submitClaim: vi.fn().mockResolvedValue(3n),
    });
    const { container } = render(
      <TestWrapper client={mockClient}>
        <ClaimForm lp={LP_ADDRESS} />
      </TestWrapper>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('AdminReviewDashboard a11y', () => {
  it('has no axe violations', async () => {
    const mockClient = createMockILNClient({
      listClaims: vi.fn().mockResolvedValue([mockInsuranceClaim]),
      getPoolBalance: vi.fn().mockResolvedValue(mockPoolBalance),
    });
    const { container } = render(
      <TestWrapper client={mockClient}>
        <AdminReviewDashboard adminAddress={LP_ADDRESS} />
      </TestWrapper>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('InsuranceAnalytics a11y', () => {
  it('has no axe violations', async () => {
    const mockClient = createMockILNClient({
      getPoolBalance: vi.fn().mockResolvedValue(mockPoolBalance),
      listClaims: vi.fn().mockResolvedValue([]),
    });
    const { container } = render(
      <TestWrapper client={mockClient}>
        <InsuranceAnalytics />
      </TestWrapper>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('LPRiskDashboard a11y', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <ILNProvider client={createMockILNClient()}>
        <LPRiskDashboard
          address={LP_ADDRESS}
          portfolio={mockPortfolio}
          invoices={[mockInvoice]}
          reputationByPayer={{ GPAYERADDR: 85 }}
        />
      </ILNProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('StatsCard a11y', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <StatsCard title="Test Metric" value="$1,000" accentColor="#8B5E34" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('StatusBadge a11y', () => {
  it('has no axe violations', async () => {
    const { container } = render(<StatusBadge status="Funded" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('AddressDisplay a11y', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <AddressDisplay address="GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
