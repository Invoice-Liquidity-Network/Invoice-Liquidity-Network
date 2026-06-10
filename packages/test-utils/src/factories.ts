import type { Invoice, InvoiceStatus, ProtocolConfig } from '../../../sdk/src/types'
import type { GovernanceProposal, ProposalAction } from '../../../sdk/src/governance-types'
import { ProposalActionKind, ProposalStatus } from '../../../sdk/src/governance-types'
import { faker } from '@faker-js/faker'

export function createInvoice(overrides?: Partial<Invoice>): Invoice {
  return {
    id: BigInt(faker.number.int({ min: 1, max: 9999 })),
    freelancer: faker.finance.ethereumAddress(),
    payer: faker.finance.ethereumAddress(),
    amount: BigInt(faker.number.int({ min: 100, max: 100000 })),
    dueDate: faker.date.future().getTime(),
    discountRate: faker.number.int({ min: 1, max: 20 }),
    status: "Pending" as InvoiceStatus,
    funder: null,
    fundedAt: null,
    ...overrides
  };
}

export function createReputationScore(overrides?: Partial<{ address: string, score: number, totalInvoices: number, paidOnTime: number, defaults: number, lastUpdated: number }>) {
  const totalInvoices = overrides?.totalInvoices ?? faker.number.int({ min: 1, max: 500 });
  return {
    address: faker.finance.ethereumAddress(),
    score: faker.number.int({ min: 0, max: 100 }),
    totalInvoices,
    paidOnTime: faker.number.int({ min: 0, max: totalInvoices }),
    defaults: faker.number.int({ min: 0, max: 5 }),
    lastUpdated: Date.now(),
    ...overrides
  };
}

export function createGovernanceProposal(overrides?: Partial<GovernanceProposal>): GovernanceProposal {
  return {
    id: BigInt(faker.number.int({ min: 1, max: 9999 })),
    proposer: faker.finance.ethereumAddress(),
    descriptionHash: Buffer.from(faker.string.hexadecimal({ length: 64 }), 'hex'),
    action: { kind: ProposalActionKind.UpdateFeeRate, rate: faker.number.int({ min: 1, max: 100 }) },
    proposedValue: BigInt(faker.number.int({ min: 1, max: 1000 })),
    status: ProposalStatus.Active,
    votesFor: BigInt(faker.number.int({ min: 0, max: 10000 })),
    votesAgainst: BigInt(faker.number.int({ min: 0, max: 10000 })),
    createdAt: faker.date.recent().getTime(),
    votingEnd: faker.date.future().getTime(),
    etaLedger: faker.number.int({ min: 1000, max: 9999 }),
    ...overrides
  };
}

export function createLPStats(overrides?: Partial<{ address: string, invoiceCount: number, totalFunded: bigint, totalYield: bigint, activeInvoices: number, defaultCount: number }>) {
  return {
    address: faker.finance.ethereumAddress(),
    invoiceCount: faker.number.int({ min: 1, max: 1000 }),
    totalFunded: BigInt(faker.number.int({ min: 1000, max: 100000 })),
    totalYield: BigInt(faker.number.int({ min: 100, max: 10000 })),
    activeInvoices: faker.number.int({ min: 0, max: 100 }),
    defaultCount: faker.number.int({ min: 0, max: 5 }),
    ...overrides
  };
}

export function createContractStats(overrides?: Partial<{ totalInvoices: number, totalVolume: bigint, totalYield: bigint, defaultRate: number }>) {
  return {
    totalInvoices: faker.number.int({ min: 1, max: 10000 }),
    totalVolume: BigInt(faker.number.int({ min: 10000, max: 9999999 })),
    totalYield: BigInt(faker.number.int({ min: 100, max: 99999 })),
    defaultRate: faker.number.float({ min: 0, max: 0.3, fractionDigits: 2 }),
    ...overrides
  };
}
