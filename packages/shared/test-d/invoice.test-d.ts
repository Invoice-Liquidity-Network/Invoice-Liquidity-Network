/**
 * Type-level tests for `InvoiceStatus`, its deprecated `InvoiceState` alias, and
 * the `Invoice` struct.
 *
 * The field-by-field assertions exist because the contract mixes u64/i128 (which
 * map to `bigint`) with u32 (which maps to `number`). Swapping one for the other
 * still type-checks at every call site that passes a literal, so only an
 * invariant assertion catches it.
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import type { Invoice, InvoiceState, InvoiceStatus } from '@iln/shared';

// ─── InvoiceStatus ────────────────────────────────────────────────────────────

// All nine on-chain states, including the five the type once omitted.
expectAssignable<InvoiceStatus>('Pending');
expectAssignable<InvoiceStatus>('PartiallyFunded');
expectAssignable<InvoiceStatus>('Funded');
expectAssignable<InvoiceStatus>('Paid');
expectAssignable<InvoiceStatus>('Defaulted');
expectAssignable<InvoiceStatus>('Appealed');
expectAssignable<InvoiceStatus>('Disputed');
expectAssignable<InvoiceStatus>('Expired');
expectAssignable<InvoiceStatus>('Cancelled');

expectNotAssignable<InvoiceStatus>('Settled');
expectNotAssignable<InvoiceStatus>('pending');
expectNotAssignable<InvoiceStatus>('');

// The deprecated alias must stay a straight alias — a narrower InvoiceState
// would silently reject statuses consumers already handle.
expectAssignable<InvoiceState>('Appealed');
expectType<InvoiceStatus>(null as unknown as InvoiceState);
expectType<InvoiceState>(null as unknown as InvoiceStatus);

// ─── Invoice: a fully specified value type-checks ─────────────────────────────

const invoice: Invoice = {
  id: 1n,
  freelancer: 'GFREELANCER',
  payer: 'GPAYER',
  token: 'CUSDC',
  amount: 25_000_000n,
  dueDate: 1_700_000_000,
  discountRate: 300,
  status: 'Pending',
  funder: null,
  fundedAt: null,
  amountFunded: 0n,
  amountPaid: 0n,
  submitterReputation: 72,
  referralCode: null,
  allowedLps: null,
  isAuction: false,
  auctionStartRate: null,
  auctionMinRate: null,
  auctionRateDecayPerHour: null,
  auctionStartedAt: null,
};

expectType<bigint>(invoice.id);
expectType<string>(invoice.freelancer);
expectType<string>(invoice.payer);
expectType<string>(invoice.token);
expectType<bigint>(invoice.amount);
expectType<number>(invoice.dueDate);
expectType<number>(invoice.discountRate);
expectType<InvoiceStatus>(invoice.status);
expectType<string | null>(invoice.funder);
expectType<number | null>(invoice.fundedAt);
expectType<bigint>(invoice.amountFunded);
expectType<bigint>(invoice.amountPaid);
expectType<number>(invoice.submitterReputation);
expectType<Uint8Array | null>(invoice.referralCode);
expectType<string[] | null>(invoice.allowedLps);
expectType<boolean>(invoice.isAuction);
expectType<number | null>(invoice.auctionStartRate);
expectType<number | null>(invoice.auctionMinRate);
expectType<number | null>(invoice.auctionRateDecayPerHour);
expectType<number | null>(invoice.auctionStartedAt);

// ─── Invoice: an auction invoice with every optional populated ────────────────

const auctionInvoice: Invoice = {
  ...invoice,
  funder: 'GFUNDER',
  fundedAt: 1_700_000_500,
  amountFunded: 25_000_000n,
  amountPaid: 25_000_000n,
  referralCode: new Uint8Array(32),
  allowedLps: ['GLP1', 'GLP2'],
  isAuction: true,
  auctionStartRate: 800,
  auctionMinRate: 200,
  auctionRateDecayPerHour: 25,
  auctionStartedAt: 1_700_000_100,
};

expectAssignable<Invoice>(auctionInvoice);

// ─── Invoice: invalid usage must not type-check ───────────────────────────────

// Missing the fields added when the type was reconciled with the contract.
expectError<Invoice>({
  id: 1n,
  freelancer: 'GFREELANCER',
  payer: 'GPAYER',
  amount: 25_000_000n,
  dueDate: 1_700_000_000,
  discountRate: 300,
  status: 'Pending',
  funder: null,
  fundedAt: null,
});

// i128/u64 fields are bigint, not number.
expectError<Invoice>({ ...invoice, amount: 25_000_000 });
expectError<Invoice>({ ...invoice, id: 1 });
expectError<Invoice>({ ...invoice, amountFunded: 0 });

// u32 fields are number, not bigint.
expectError<Invoice>({ ...invoice, dueDate: 1_700_000_000n });
expectError<Invoice>({ ...invoice, discountRate: 300n });

// Nullable fields are nullable, not optional-undefined.
expectError<Invoice>({ ...invoice, funder: undefined });
expectError<Invoice>({ ...invoice, allowedLps: 'GLP1' });

// Unknown status, and fields that never existed on the contract struct.
expectError<Invoice>({ ...invoice, status: 'Settled' });
expectError<Invoice>({ ...invoice, createdAt: 1_700_000_000 });
