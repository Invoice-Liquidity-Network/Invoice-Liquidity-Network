// !! AUTO-GENERATED — do not edit by hand.
// Re-generate with: pnpm generate:types
// Source: ILN-Smart-Contract/target/spec.json
//
// NOTE: This file intentionally duplicates some type names from @iln/shared.
// It is auto-generated from the contract spec and must not be hand-edited.
// The types here may be a subset or older version of @iln/shared — consumers
// should prefer @iln/shared for the canonical definitions.

/** Status of an invoice in its lifecycle. */
export enum InvoiceStatus {
  Pending = 0,
  Funded = 1,
  Paid = 2,
  Defaulted = 3,
}

/** An invoice submitted by a freelancer. */
export interface Invoice {
  id: bigint;
  freelancer: string;
  payer: string;
  /** Token amount in stroops (7 decimal places). */
  amount: bigint;
  /** Unix timestamp of the invoice due date. */
  dueDate: number;
  /** Discount rate in basis points (e.g. 300 = 3%). */
  discountRate: number;
  status: InvoiceStatus;
  funder: string | null;
  fundedAt: number | null;
}

/** Parameters for submitting a new invoice. */
export interface SubmitInvoiceParams {
  freelancer: string;
  payer: string;
  amount: bigint;
  dueDate: number;
  discountRate: number;
}

/** Parameters for funding an invoice. */
export interface FundInvoiceParams {
  funder: string;
  invoiceId: bigint;
}

/** Parameters for marking an invoice paid. */
export interface MarkPaidParams {
  invoiceId: bigint;
}

/** Parameters for claiming a default on an overdue invoice. */
export interface ClaimDefaultParams {
  funder: string;
  invoiceId: bigint;
}

/** Contract-level errors returned by the ILN smart contract. */
export enum ContractError {
  InvoiceNotFound = 1,
  AlreadyFunded = 2,
  AlreadyPaid = 3,
  NotFunder = 4,
  NotPayer = 5,
  NotDueYet = 6,
  InvalidAmount = 7,
  InvalidDiscount = 8,
  InvalidDueDate = 9,
  Unauthorized = 10,
}
