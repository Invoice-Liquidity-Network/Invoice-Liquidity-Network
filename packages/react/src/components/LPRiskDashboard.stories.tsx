import type { Invoice, LPPortfolio } from '@invoice-liquidity/sdk';
import { ILNProvider } from '../context';
import {
  LPRiskDashboard,
  MaturityProfileChart,
  PayerConcentrationChart,
  TokenDiversificationChart,
} from './LPRiskDashboard';
import type { LPRiskMetrics } from '../hooks/lpRiskMetrics';
import { calculateLPRiskMetrics } from '../hooks/lpRiskMetrics';

const ADDRESS = 'GLPTESTADDRESS000000000000000000000000000000000000000000';
const NOW = Date.UTC(2026, 0, 1);

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

const metrics: LPRiskMetrics = calculateLPRiskMetrics({
  address: ADDRESS,
  invoices,
  portfolio,
  reputationByPayer: new Map([
    ['GPAYER_A', 80],
    ['GPAYER_B', 40],
    ['GPAYER_C', 20],
  ]),
  now: NOW,
  simulations: 1000,
});

const mockClient = {
  getLPPortfolio: async () => portfolio,
  getInvoicesByStatus: async () => invoices,
  getReputationScore: async () => 80,
} as never;

export default {
  title: 'LP/LPRiskDashboard',
  component: LPRiskDashboard,
};

export const Dashboard = () => (
  <ILNProvider client={mockClient}>
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
  </ILNProvider>
);

export const Concentration = () => <PayerConcentrationChart data={metrics.payerExposure} />;

export const Tokens = () => <TokenDiversificationChart data={metrics.tokenDiversification} />;

export const Maturity = () => <MaturityProfileChart data={metrics.maturityProfile} />;
