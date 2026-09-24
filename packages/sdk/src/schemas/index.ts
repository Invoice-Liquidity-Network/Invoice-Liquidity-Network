/**
 * packages/sdk/src/schemas/index.ts
 *
 * Public API for the event schema validation module.
 */

export {
  SCHEMA_VERSION,
  EVENT_SCHEMAS,
  // Individual schemas (for direct use)
  OracleRegisteredSchema,
  OracleUnregisteredSchema,
  OracleHealthRecordedSchema,
  InsuranceClaimAttemptedSchema,
  TokenAddedSchema,
  TokenRemovedSchema,
  InvoiceSubmittedSchema,
  InvoiceUpdatedSchema,
  InvoiceFundedSchema,
  InvoicePaidSchema,
  InvoicePartiallyPaidSchema,
  ContractPausedSchema,
  ContractUnpausedSchema,
  InvoiceDefaultedSchema,
  InvoiceTransferredSchema,
  InvoiceCancelledSchema,
  LPPositionTransferredSchema,
  AdminChangedSchema,
  ParameterUpdatedSchema,
  ContractUpgradedSchema,
  DistributionContractUpdatedSchema,
  PriceOracleUpdatedSchema,
  ContractInitializedSchema,
  DefaultAppealedSchema,
  AppealResolvedSchema,
  InvoiceDisputedSchema,
  DisputeResolvedSchema,
  DisputeUpheldPayerRefundSchema,
  FundRequestedSchema,
  FundQueueResolvedSchema,
  FundQueueResolutionAttemptedSchema,
  InvoiceExpiredSchema,
  ReputationUpdatedSchema,
  InvoiceTokenChangedSchema,
  InvoiceNftMintedSchema,
  InvoiceNftTransferredSchema,
  InvoiceNftBurnedSchema,
} from './events';

export type { EventTypeName, ValidatedContractEvent } from './events';

export { validateEvent, EventValidationError } from './validateEvent';
export type { ValidatedEvent } from './validateEvent';

export { withEventValidation, createValidatedHandler } from './middleware';
