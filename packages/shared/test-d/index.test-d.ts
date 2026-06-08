import { expectAssignable, expectType } from "tsd";
import type {
  ContractEvent,
  ContractStats,
  GovernanceProposal,
  Invoice,
  InvoiceState,
  LPStats,
  ProposalStatus,
  ReputationScore,
  Token,
} from "@iln/shared";

const invoice: Invoice = {
  id: 1n,
  freelancer: "GFRL",
  payer: "GPYR",
  amount: 25_000_000n,
  dueDate: 1_700_000_000,
  discountRate: 300,
  status: "Pending",
  funder: null,
  fundedAt: null,
};

expectType<InvoiceState>(invoice.status);

const proposal: GovernanceProposal = {
  id: 1n,
  proposer: "GPRO",
  title: "Lower fees",
  description: "Reduce protocol fees for active markets.",
  status: "Active",
  createdAt: 1_700_000_000,
  votingEndsAt: 1_700_259_200,
  executedAt: null,
  forVotes: 10n,
  againstVotes: 2n,
  abstainVotes: 0n,
};

expectAssignable<ProposalStatus>(proposal.status);

const token: Token = {
  contractId: "CTOKEN",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 7,
  issuer: "GISSUER",
  listed: true,
};

expectType<string>(token.symbol);

const contractStats: ContractStats = {
  totalInvoices: 3,
  totalVolume: 75_000_000n,
  totalYield: 1_250_000n,
  defaultRate: 0.1,
};

expectType<bigint>(contractStats.totalVolume);

const lpStats: LPStats = {
  deployed: 50_000_000n,
  yield: 1_000_000n,
  invoiceCount: 2,
  defaultRate: 0.05,
};

expectType<number>(lpStats.invoiceCount);

const reputationScore: ReputationScore = {
  address: "GADDR",
  score: 87,
  updatedAt: 1_700_000_000,
};

expectType<number>(reputationScore.score);

const event: ContractEvent = {
  type: "InvoiceFunded",
  contractId: "C123",
  ledger: 12,
  ledgerClosedAt: "2024-01-01T00:00:00Z",
  txHash: "abc123",
  pagingToken: "12-0",
  invoiceId: 1n,
  funder: "GFUND",
  amount: 25_000_000n,
};

if (event.type === "InvoiceFunded") {
  expectType<bigint>(event.amount);
  expectType<string>(event.funder);
}
