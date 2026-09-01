/**
 * packages/sdk/src/schemas/events.ts
 *
 * Zod schemas for all 37 Soroban contract events defined in
 * backend/contracts/invoice_liquidity/src/events.rs.
 *
 * These schemas serve as runtime validation boundaries for event data
 * entering the SDK, indexer, and notification service. They enforce
 * type correctness that the existing TypeScript interfaces cannot guarantee
 * at runtime (e.g. bigint coercion, optional field presence, enum variants).
 *
 * Type mapping (Rust → Zod):
 *   u64 / i128  → z.bigint()
 *   u32          → z.number().int().nonnegative()
 *   Address      → z.string()
 *   bool         → z.boolean()
 *   Option<T>    → z.nullable(schema)
 *   BytesN<32>   → z.union([z.instanceof(Uint8Array), z.string()])
 *   Symbol       → z.string()
 *   enums        → z.enum([...])
 *
 * DO NOT edit by hand without updating events.rs first.
 */

import { z } from 'zod';

// ─── Shared primitives ──────────────────────────────────────────────────────

/** Stellar address (G... or C... account/contract address). */
const AddressSchema = z.string().min(1);

/** 64-bit unsigned integer (Soroban u64). Maps to JS BigInt. */
const U64Schema = z.bigint().nonnegative();

/**
 * 128-bit signed integer (Soroban i128). Maps to JS BigInt.
 * Enforces the valid i128 range on both ends.
 */
const I128Schema = z
  .bigint()
  .min(BigInt('-170141183460469231731687303715884105728'))
  .max(BigInt('170141183460469231731687303715884105727'));

/** 32-bit unsigned integer (Soroban u32). Maps to JS number. */
const U32Schema = z.number().int().nonnegative();

/**
 * 32-byte hash (Soroban BytesN<32>).
 * Accepts both Uint8Array and hex-encoded strings; normalizes to Uint8Array.
 */
const BytesN32Schema = z
  .union([
    z.instanceof(Uint8Array),
    z.string().regex(/^[0-9a-fA-F]{64}$/, 'Must be a 64-character hex string'),
  ])
  .transform((val) => {
    if (val instanceof Uint8Array) return val;
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(val.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  });

// ─── Contract enums ─────────────────────────────────────────────────────────

/**
 * All nine on-chain invoice states.
 * Matches: InvoiceStatus enum in invoice.rs
 */
const InvoiceStatusSchema = z.enum([
  'Pending',
  'Funded',
  'PartiallyFunded',
  'Paid',
  'Defaulted',
  'Appealed',
  'Disputed',
  'Expired',
  'Cancelled',
]);

/**
 * Oracle feed type.
 * Matches: OracleFeedType enum in oracle_registry.rs
 */
const OracleFeedTypeSchema = z.enum(['Price', 'Identity', 'Credit']);

/**
 * Referral code — Soroban enum with None/Present variants.
 * Matches: ReferralCode enum in invoice.rs
 */
const ReferralCodeSchema = z.discriminatedUnion('tag', [
  z.object({ tag: z.literal('None') }),
  z.object({ tag: z.literal('Present'), value: BytesN32Schema }),
]);

// ─── Event schemas ──────────────────────────────────────────────────────────

/**
 * 1. OracleRegistered
 * Rust: feed_type (OracleFeedType), token (Option<Address>), oracle (Address)
 */
export const OracleRegisteredSchema = z.object({
  type: z.literal('OracleRegistered'),
  feedType: OracleFeedTypeSchema,
  token: AddressSchema.nullable(),
  oracle: AddressSchema,
});

/**
 * 2. OracleUnregistered
 * Rust: feed_type (OracleFeedType), token (Option<Address>)
 */
export const OracleUnregisteredSchema = z.object({
  type: z.literal('OracleUnregistered'),
  feedType: OracleFeedTypeSchema,
  token: AddressSchema.nullable(),
});

/**
 * 3. OracleHealthRecorded
 * Rust: feed_type (OracleFeedType), token (Address), is_stale (bool),
 *       last_data_age_ledgers (u64), consecutive_stale_count (u32)
 */
export const OracleHealthRecordedSchema = z.object({
  type: z.literal('OracleHealthRecorded'),
  feedType: OracleFeedTypeSchema,
  token: AddressSchema,
  isStale: z.boolean(),
  lastDataAgeLedgers: U64Schema,
  consecutiveStaleCount: U32Schema,
});

/**
 * 4. InsuranceClaimAttempted
 * Rust: invoice_id (u64), lp (Address), compensated (bool), payout (i128)
 */
export const InsuranceClaimAttemptedSchema = z.object({
  type: z.literal('InsuranceClaimAttempted'),
  invoiceId: U64Schema,
  lp: AddressSchema,
  compensated: z.boolean(),
  payout: I128Schema,
});

/**
 * 5. TokenAdded
 * Rust: token (Address), decimals (u32)
 */
export const TokenAddedSchema = z.object({
  type: z.literal('TokenAdded'),
  token: AddressSchema,
  decimals: U32Schema,
});

/**
 * 6. TokenRemoved
 * Rust: token (Address)
 */
export const TokenRemovedSchema = z.object({
  type: z.literal('TokenRemoved'),
  token: AddressSchema,
});

/**
 * 7. InvoiceSubmitted
 * Rust: invoice_id (u64), freelancer (Address), payer (Address),
 *       token (Address), amount (i128), due_date (u64), discount_rate (u32),
 *       referral_code (ReferralCode), status (InvoiceStatus), timestamp (u64)
 */
export const InvoiceSubmittedSchema = z.object({
  type: z.literal('InvoiceSubmitted'),
  invoiceId: U64Schema,
  freelancer: AddressSchema,
  payer: AddressSchema,
  token: AddressSchema,
  amount: I128Schema,
  dueDate: U64Schema,
  discountRate: U32Schema,
  referralCode: ReferralCodeSchema,
  status: InvoiceStatusSchema,
  timestamp: U64Schema,
});

/**
 * 8. InvoiceUpdated
 * Rust: invoice_id (u64), freelancer (Address), payer (Address),
 *       token (Address), amount (i128), due_date (u64), discount_rate (u32),
 *       status (InvoiceStatus)
 */
export const InvoiceUpdatedSchema = z.object({
  type: z.literal('InvoiceUpdated'),
  invoiceId: U64Schema,
  freelancer: AddressSchema,
  payer: AddressSchema,
  token: AddressSchema,
  amount: I128Schema,
  dueDate: U64Schema,
  discountRate: U32Schema,
  status: InvoiceStatusSchema,
});

/**
 * 9. InvoiceFunded
 * Rust: invoice_id (u64), funder (Address), freelancer (Address),
 *       payer (Address), token (Address), fund_amount (i128),
 *       amount_funded (i128), invoice_amount (i128), due_date (u64),
 *       discount_rate (u32), funded_at (Option<u64>), status (InvoiceStatus),
 *       lp (Address), effective_yield_bps (u32), timestamp (u64)
 */
export const InvoiceFundedSchema = z.object({
  type: z.literal('InvoiceFunded'),
  invoiceId: U64Schema,
  funder: AddressSchema,
  freelancer: AddressSchema,
  payer: AddressSchema,
  token: AddressSchema,
  fundAmount: I128Schema,
  amountFunded: I128Schema,
  invoiceAmount: I128Schema,
  dueDate: U64Schema,
  discountRate: U32Schema,
  fundedAt: U64Schema.nullable(),
  status: InvoiceStatusSchema,
  lp: AddressSchema,
  effectiveYieldBps: U32Schema,
  timestamp: U64Schema,
});

/**
 * 10. InvoicePaid
 * Rust: invoice_id (u64), payer (Address), lp (Address), freelancer (Address),
 *        token (Address), amount_paid (i128), lp_earned (i128),
 *        lp_payout (i128), settlement_timestamp (u64), paid_on_time (bool),
 *        status (InvoiceStatus)
 */
export const InvoicePaidSchema = z.object({
  type: z.literal('InvoicePaid'),
  invoiceId: U64Schema,
  payer: AddressSchema,
  lp: AddressSchema,
  freelancer: AddressSchema,
  token: AddressSchema,
  amountPaid: I128Schema,
  lpEarned: I128Schema,
  lpPayout: I128Schema,
  settlementTimestamp: U64Schema,
  paidOnTime: z.boolean(),
  status: InvoiceStatusSchema,
});

/**
 * 11. InvoicePartiallyPaid
 * Rust: invoice_id (u64), payer (Address), amount_paid_now (i128),
 *        total_amount_paid (i128), remaining_amount (i128)
 */
export const InvoicePartiallyPaidSchema = z.object({
  type: z.literal('InvoicePartiallyPaid'),
  invoiceId: U64Schema,
  payer: AddressSchema,
  amountPaidNow: I128Schema,
  totalAmountPaid: I128Schema,
  remainingAmount: I128Schema,
});

/**
 * 12. ContractPaused
 * Rust: timestamp (u64)
 */
export const ContractPausedSchema = z.object({
  type: z.literal('ContractPaused'),
  timestamp: U64Schema,
});

/**
 * 13. ContractUnpaused
 * Rust: timestamp (u64)
 */
export const ContractUnpausedSchema = z.object({
  type: z.literal('ContractUnpaused'),
  timestamp: U64Schema,
});

/**
 * 14. InvoiceDefaulted
 * Rust: invoice_id (u64), funder (Address), freelancer (Address),
 *        payer (Address), token (Address), amount (i128), due_date (u64),
 *        defaulted_at (u64), discount_amount (i128), status (InvoiceStatus)
 */
export const InvoiceDefaultedSchema = z.object({
  type: z.literal('InvoiceDefaulted'),
  invoiceId: U64Schema,
  funder: AddressSchema,
  freelancer: AddressSchema,
  payer: AddressSchema,
  token: AddressSchema,
  amount: I128Schema,
  dueDate: U64Schema,
  defaultedAt: U64Schema,
  discountAmount: I128Schema,
  status: InvoiceStatusSchema,
});

/**
 * 15. InvoiceTransferred
 * Rust: invoice_id (u64), old_freelancer (Address),
 *        new_freelancer (Address), status (InvoiceStatus)
 */
export const InvoiceTransferredSchema = z.object({
  type: z.literal('InvoiceTransferred'),
  invoiceId: U64Schema,
  oldFreelancer: AddressSchema,
  newFreelancer: AddressSchema,
  status: InvoiceStatusSchema,
});

/**
 * 16. InvoiceCancelled
 * Rust: invoice_id (u64), freelancer (Address), status (InvoiceStatus)
 */
export const InvoiceCancelledSchema = z.object({
  type: z.literal('InvoiceCancelled'),
  invoiceId: U64Schema,
  freelancer: AddressSchema,
  status: InvoiceStatusSchema,
});

/**
 * 17. LPPositionTransferred
 * Rust: invoice_id (u64), old_lp (Address), new_lp (Address),
 *        status (InvoiceStatus)
 */
export const LPPositionTransferredSchema = z.object({
  type: z.literal('LPPositionTransferred'),
  invoiceId: U64Schema,
  oldLp: AddressSchema,
  newLp: AddressSchema,
  status: InvoiceStatusSchema,
});

/**
 * 18. AdminChanged
 * Rust: old_admin (Address), new_admin (Address), timestamp (u64)
 */
export const AdminChangedSchema = z.object({
  type: z.literal('AdminChanged'),
  oldAdmin: AddressSchema,
  newAdmin: AddressSchema,
  timestamp: U64Schema,
});

/**
 * 19. ParameterUpdated
 * Rust: param_name (Symbol), old_value (i128), new_value (i128),
 *        updated_by (Address)
 */
export const ParameterUpdatedSchema = z.object({
  type: z.literal('ParameterUpdated'),
  paramName: z.string().min(1),
  oldValue: I128Schema,
  newValue: I128Schema,
  updatedBy: AddressSchema,
});

/**
 * 20. ContractUpgraded
 * Rust: admin (Address), new_wasm_hash (BytesN<32>), timestamp (u64)
 */
export const ContractUpgradedSchema = z.object({
  type: z.literal('ContractUpgraded'),
  admin: AddressSchema,
  newWasmHash: BytesN32Schema,
  timestamp: U64Schema,
});

/**
 * 21. DistributionContractUpdated
 * Rust: old_distribution_contract (Option<Address>),
 *        new_distribution_contract (Address), updated_by (Address)
 */
export const DistributionContractUpdatedSchema = z.object({
  type: z.literal('DistributionContractUpdated'),
  oldDistributionContract: AddressSchema.nullable(),
  newDistributionContract: AddressSchema,
  updatedBy: AddressSchema,
});

/**
 * 22. PriceOracleUpdated
 * Rust: old_oracle (Option<Address>), new_oracle (Address),
 *        updated_by (Address)
 */
export const PriceOracleUpdatedSchema = z.object({
  type: z.literal('PriceOracleUpdated'),
  oldOracle: AddressSchema.nullable(),
  newOracle: AddressSchema,
  updatedBy: AddressSchema,
});

/**
 * 23. ContractInitialized
 * Rust: admin (Address), usdc_token (Address), eurc_token (Address),
 *        xlm_token (Address), timestamp (u64)
 */
export const ContractInitializedSchema = z.object({
  type: z.literal('ContractInitialized'),
  admin: AddressSchema,
  usdcToken: AddressSchema,
  eurcToken: AddressSchema,
  xlmToken: AddressSchema,
  timestamp: U64Schema,
});

/**
 * 24. DefaultAppealed
 * Rust: invoice_id (u64), payer (Address), evidence_hash (BytesN<32>),
 *        appealed_at (u64)
 */
export const DefaultAppealedSchema = z.object({
  type: z.literal('DefaultAppealed'),
  invoiceId: U64Schema,
  payer: AddressSchema,
  evidenceHash: BytesN32Schema,
  appealedAt: U64Schema,
});

/**
 * 25. AppealResolved
 * Rust: invoice_id (u64), payer (Address), upheld (bool),
 *        resolved_at (u64)
 */
export const AppealResolvedSchema = z.object({
  type: z.literal('AppealResolved'),
  invoiceId: U64Schema,
  payer: AddressSchema,
  upheld: z.boolean(),
  resolvedAt: U64Schema,
});

/**
 * 26. InvoiceDisputed
 * Rust: invoice_id (u64), payer (Address), reason_hash (BytesN<32>),
 *        disputed_at (u64)
 */
export const InvoiceDisputedSchema = z.object({
  type: z.literal('InvoiceDisputed'),
  invoiceId: U64Schema,
  payer: AddressSchema,
  reasonHash: BytesN32Schema,
  disputedAt: U64Schema,
});

/**
 * 27. DisputeResolved
 * Rust: invoice_id (u64), resolution_hash (BytesN<32>),
 *        resolution (u32), resolved_at (u64)
 *
 * Resolution values: 1 = Upheld (Payer right), 2 = Rejected (Freelancer right)
 */
export const DisputeResolvedSchema = z.object({
  type: z.literal('DisputeResolved'),
  invoiceId: U64Schema,
  resolutionHash: BytesN32Schema,
  resolution: z.number().int().min(1).max(2),
  resolvedAt: U64Schema,
});

/**
 * 28. DisputeUpheldPayerRefund
 * Rust: invoice_id (u64), payer (Address), amount (i128)
 */
export const DisputeUpheldPayerRefundSchema = z.object({
  type: z.literal('DisputeUpheldPayerRefund'),
  invoiceId: U64Schema,
  payer: AddressSchema,
  amount: I128Schema,
});

/**
 * 29. FundRequested
 * Rust: invoice_id (u64), lp (Address), score (u32)
 */
export const FundRequestedSchema = z.object({
  type: z.literal('FundRequested'),
  invoiceId: U64Schema,
  lp: AddressSchema,
  score: U32Schema,
});

/**
 * 30. FundQueueResolved
 * Rust: invoice_id (u64), approved_lp (Address), score (u32)
 */
export const FundQueueResolvedSchema = z.object({
  type: z.literal('FundQueueResolved'),
  invoiceId: U64Schema,
  approvedLp: AddressSchema,
  score: U32Schema,
});

/**
 * 31. FundQueueResolutionAttempted
 * Rust: invoice_id (u64), caller_ledger (u32),
 *        attempted_at_ledger (u32), success (bool)
 */
export const FundQueueResolutionAttemptedSchema = z.object({
  type: z.literal('FundQueueResolutionAttempted'),
  invoiceId: U64Schema,
  callerLedger: U32Schema,
  attemptedAtLedger: U32Schema,
  success: z.boolean(),
});

/**
 * 32. InvoiceExpired
 * Rust: invoice_id (u64), freelancer (Address), status (InvoiceStatus)
 */
export const InvoiceExpiredSchema = z.object({
  type: z.literal('InvoiceExpired'),
  invoiceId: U64Schema,
  freelancer: AddressSchema,
  status: InvoiceStatusSchema,
});

/**
 * 33. ReputationUpdated
 * Rust: address (Address), old_score (u32), new_score (u32),
 *        invoices_submitted (u32), invoices_paid (u32),
 *        invoices_defaulted (u32)
 */
export const ReputationUpdatedSchema = z.object({
  type: z.literal('ReputationUpdated'),
  address: AddressSchema,
  oldScore: U32Schema,
  newScore: U32Schema,
  invoicesSubmitted: U32Schema,
  invoicesPaid: U32Schema,
  invoicesDefaulted: U32Schema,
});

/**
 * 34. InvoiceTokenChanged
 * Rust: invoice_id (u64), old_token (Address), new_token (Address)
 */
export const InvoiceTokenChangedSchema = z.object({
  type: z.literal('InvoiceTokenChanged'),
  invoiceId: U64Schema,
  oldToken: AddressSchema,
  newToken: AddressSchema,
});

/**
 * 35. InvoiceNftMinted
 * Rust: invoice_id (u64), owner (Address), amount (i128),
 *        due_date (u32), timestamp (u64)
 */
export const InvoiceNftMintedSchema = z.object({
  type: z.literal('InvoiceNftMinted'),
  invoiceId: U64Schema,
  owner: AddressSchema,
  amount: I128Schema,
  dueDate: U32Schema,
  timestamp: U64Schema,
});

/**
 * 36. InvoiceNftTransferred
 * Rust: invoice_id (u64), from (Address), to (Address), timestamp (u64)
 */
export const InvoiceNftTransferredSchema = z.object({
  type: z.literal('InvoiceNftTransferred'),
  invoiceId: U64Schema,
  from: AddressSchema,
  to: AddressSchema,
  timestamp: U64Schema,
});

/**
 * 37. InvoiceNftBurned
 * Rust: invoice_id (u64), owner (Address), timestamp (u64)
 */
export const InvoiceNftBurnedSchema = z.object({
  type: z.literal('InvoiceNftBurned'),
  invoiceId: U64Schema,
  owner: AddressSchema,
  timestamp: U64Schema,
});

// ─── Schema registry ────────────────────────────────────────────────────────

/**
 * Schema version — increment when any schema changes shape.
 * Consumers can pin to a specific version for forward compatibility.
 */
export const SCHEMA_VERSION = 1;

/**
 * Registry of all event schemas keyed by event type name.
 * Used by `validateEvent()` to dispatch validation.
 */
export const EVENT_SCHEMAS = {
  OracleRegistered: OracleRegisteredSchema,
  OracleUnregistered: OracleUnregisteredSchema,
  OracleHealthRecorded: OracleHealthRecordedSchema,
  InsuranceClaimAttempted: InsuranceClaimAttemptedSchema,
  TokenAdded: TokenAddedSchema,
  TokenRemoved: TokenRemovedSchema,
  InvoiceSubmitted: InvoiceSubmittedSchema,
  InvoiceUpdated: InvoiceUpdatedSchema,
  InvoiceFunded: InvoiceFundedSchema,
  InvoicePaid: InvoicePaidSchema,
  InvoicePartiallyPaid: InvoicePartiallyPaidSchema,
  ContractPaused: ContractPausedSchema,
  ContractUnpaused: ContractUnpausedSchema,
  InvoiceDefaulted: InvoiceDefaultedSchema,
  InvoiceTransferred: InvoiceTransferredSchema,
  InvoiceCancelled: InvoiceCancelledSchema,
  LPPositionTransferred: LPPositionTransferredSchema,
  AdminChanged: AdminChangedSchema,
  ParameterUpdated: ParameterUpdatedSchema,
  ContractUpgraded: ContractUpgradedSchema,
  DistributionContractUpdated: DistributionContractUpdatedSchema,
  PriceOracleUpdated: PriceOracleUpdatedSchema,
  ContractInitialized: ContractInitializedSchema,
  DefaultAppealed: DefaultAppealedSchema,
  AppealResolved: AppealResolvedSchema,
  InvoiceDisputed: InvoiceDisputedSchema,
  DisputeResolved: DisputeResolvedSchema,
  DisputeUpheldPayerRefund: DisputeUpheldPayerRefundSchema,
  FundRequested: FundRequestedSchema,
  FundQueueResolved: FundQueueResolvedSchema,
  FundQueueResolutionAttempted: FundQueueResolutionAttemptedSchema,
  InvoiceExpired: InvoiceExpiredSchema,
  ReputationUpdated: ReputationUpdatedSchema,
  InvoiceTokenChanged: InvoiceTokenChangedSchema,
  InvoiceNftMinted: InvoiceNftMintedSchema,
  InvoiceNftTransferred: InvoiceNftTransferredSchema,
  InvoiceNftBurned: InvoiceNftBurnedSchema,
} as const;

/** All known event type names. */
export type EventTypeName = keyof typeof EVENT_SCHEMAS;

// ─── Inferred TypeScript types ──────────────────────────────────────────────

export type OracleRegisteredEvent = z.infer<typeof OracleRegisteredSchema>;
export type OracleUnregisteredEvent = z.infer<typeof OracleUnregisteredSchema>;
export type OracleHealthRecordedEvent = z.infer<typeof OracleHealthRecordedSchema>;
export type InsuranceClaimAttemptedEvent = z.infer<typeof InsuranceClaimAttemptedSchema>;
export type TokenAddedEvent = z.infer<typeof TokenAddedSchema>;
export type TokenRemovedEvent = z.infer<typeof TokenRemovedSchema>;
export type InvoiceSubmittedEvent = z.infer<typeof InvoiceSubmittedSchema>;
export type InvoiceUpdatedEvent = z.infer<typeof InvoiceUpdatedSchema>;
export type InvoiceFundedEvent = z.infer<typeof InvoiceFundedSchema>;
export type InvoicePaidEvent = z.infer<typeof InvoicePaidSchema>;
export type InvoicePartiallyPaidEvent = z.infer<typeof InvoicePartiallyPaidSchema>;
export type ContractPausedEvent = z.infer<typeof ContractPausedSchema>;
export type ContractUnpausedEvent = z.infer<typeof ContractUnpausedSchema>;
export type InvoiceDefaultedEvent = z.infer<typeof InvoiceDefaultedSchema>;
export type InvoiceTransferredEvent = z.infer<typeof InvoiceTransferredSchema>;
export type InvoiceCancelledEvent = z.infer<typeof InvoiceCancelledSchema>;
export type LPPositionTransferredEvent = z.infer<typeof LPPositionTransferredSchema>;
export type AdminChangedEvent = z.infer<typeof AdminChangedSchema>;
export type ParameterUpdatedEvent = z.infer<typeof ParameterUpdatedSchema>;
export type ContractUpgradedEvent = z.infer<typeof ContractUpgradedSchema>;
export type DistributionContractUpdatedEvent = z.infer<typeof DistributionContractUpdatedSchema>;
export type PriceOracleUpdatedEvent = z.infer<typeof PriceOracleUpdatedSchema>;
export type ContractInitializedEvent = z.infer<typeof ContractInitializedSchema>;
export type DefaultAppealedEvent = z.infer<typeof DefaultAppealedSchema>;
export type AppealResolvedEvent = z.infer<typeof AppealResolvedSchema>;
export type InvoiceDisputedEvent = z.infer<typeof InvoiceDisputedSchema>;
export type DisputeResolvedEvent = z.infer<typeof DisputeResolvedSchema>;
export type DisputeUpheldPayerRefundEvent = z.infer<typeof DisputeUpheldPayerRefundSchema>;
export type FundRequestedEvent = z.infer<typeof FundRequestedSchema>;
export type FundQueueResolvedEvent = z.infer<typeof FundQueueResolvedSchema>;
export type FundQueueResolutionAttemptedEvent = z.infer<typeof FundQueueResolutionAttemptedSchema>;
export type InvoiceExpiredEvent = z.infer<typeof InvoiceExpiredSchema>;
export type ReputationUpdatedEvent = z.infer<typeof ReputationUpdatedSchema>;
export type InvoiceTokenChangedEvent = z.infer<typeof InvoiceTokenChangedSchema>;
export type InvoiceNftMintedEvent = z.infer<typeof InvoiceNftMintedSchema>;
export type InvoiceNftTransferredEvent = z.infer<typeof InvoiceNftTransferredSchema>;
export type InvoiceNftBurnedEvent = z.infer<typeof InvoiceNftBurnedSchema>;

/** Discriminated union of all 37 validated event types. */
export type ValidatedContractEvent =
  | OracleRegisteredEvent
  | OracleUnregisteredEvent
  | OracleHealthRecordedEvent
  | InsuranceClaimAttemptedEvent
  | TokenAddedEvent
  | TokenRemovedEvent
  | InvoiceSubmittedEvent
  | InvoiceUpdatedEvent
  | InvoiceFundedEvent
  | InvoicePaidEvent
  | InvoicePartiallyPaidEvent
  | ContractPausedEvent
  | ContractUnpausedEvent
  | InvoiceDefaultedEvent
  | InvoiceTransferredEvent
  | InvoiceCancelledEvent
  | LPPositionTransferredEvent
  | AdminChangedEvent
  | ParameterUpdatedEvent
  | ContractUpgradedEvent
  | DistributionContractUpdatedEvent
  | PriceOracleUpdatedEvent
  | ContractInitializedEvent
  | DefaultAppealedEvent
  | AppealResolvedEvent
  | InvoiceDisputedEvent
  | DisputeResolvedEvent
  | DisputeUpheldPayerRefundEvent
  | FundRequestedEvent
  | FundQueueResolvedEvent
  | FundQueueResolutionAttemptedEvent
  | InvoiceExpiredEvent
  | ReputationUpdatedEvent
  | InvoiceTokenChangedEvent
  | InvoiceNftMintedEvent
  | InvoiceNftTransferredEvent
  | InvoiceNftBurnedEvent;
