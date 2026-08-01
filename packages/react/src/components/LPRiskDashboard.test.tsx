import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { Invoice, LPPortfolio } from '@invoice-liquidity/sdk';
import { ILNProvider } from '../context';
import { LPRiskDashboard } from './LPRiskDashboard';

expect.extend(toHaveNoViolations);

const NOW = Date.UTC(2026, 0, 1);
const ADDRESS = 'GLPTESTADDRESS000000000000000000000000000000000000000000';

const portfolio = {
  address: ADDRESS,
  invoiceCount: 8,
  defaultedPositions: 1,
  completedPositions: 3,
  activePositions: 4,
  totalInvested: 300n,
  totalYield: 10n,
  avgReturn: 3.2,
} as unknown as LPPortfolio;

const invoices = [
  {
    id: 1n,
    issuer: 'GISSUER_1',
    payer: 'GPAYER_A',
    amount: 100n,
    discountRate: 300,
    dueDate: NOW + (5 * 86_400_000),
    status: 'Funded',
    fundedBy: ADDRESS,
    token: 'USDC_CONTRACT_ID',
  },
  {
    id: 2n,
    issuer: 'GISSUER_2',
    payer: 'GPAYER_A',
    amount: 100n,
    discountRate: 200,
    dueDate: NOW + (20 * 86_400_000),
    status: 'Funded',
    fundedBy: ADDRESS,
    token: 'USDC_CONTRACT_ID',
  },
  {
    id: 3n,
    issuer: 'GISSUER_3',
    payer: 'GPAYER_B',
    amount: 50n,
    discountRate: 400,
    dueDate: NOW + (40 * 86_400_000),
    status: 'Funded',
    fundedBy: ADDRESS,
    token: 'EURC_CONTRACT_ID',
  },
  {
    id: 4n,
    issuer: 'GISSUER_4',
    payer: 'GPAYER_C',
    amount: 50n,
    discountRate: 500,
    dueDate: NOW + (120 * 86_400_000),
    status: 'Funded',
    fundedBy: ADDRESS,
    token: 'XLM',
  },
] as Invoice[];

const mockClient = {
  getLPPortfolio: async () => portfolio,
  getInvoicesByStatus: async () => invoices,
  getReputationScore: async () => 80,
} as never;

describe('LPRiskDashboard', () => {
  it('renders an accessible dashboard summary', async () => {
    const { container, getByText } = render(
      <ILNProvider client={mockClient}>
        <div style={{ width: 1280 }}>
          <LPRiskDashboard
            address={ADDRESS}
            portfolio={portfolio}
            invoices={invoices}
            reputationByPayer={{
              GPAYER_A: 80,
              GPAYER_B: 40,
              GPAYER_C: 20,
            }}
            simulations={1000}
          />
        </div>
      </ILNProvider>,
    );

    expect(getByText('Comprehensive portfolio risk analytics for LPs')).toBeTruthy();
    expect(getByText('Herd Risk')).toBeTruthy();
    expect(getByText('Concentration Risk')).toBeTruthy();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
