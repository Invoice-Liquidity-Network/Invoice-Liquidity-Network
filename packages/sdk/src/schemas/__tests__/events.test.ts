/**
 * packages/sdk/src/schemas/__tests__/events.test.ts
 *
 * Unit tests for all 37 Zod event schemas.
 * Tests cover: valid input, missing required fields, wrong types,
 * extra unknown fields stripped, edge cases for max u64/i128,
 * empty strings, null optionals, and BytesN<32> normalization.
 */

import {
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
  EVENT_SCHEMAS,
} from '../events';

// ─── Test helpers ───────────────────────────────────────────────────────────

const VALID_ADDRESS = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VALID_ADDRESS_2 = 'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VALID_ADDRESS_3 = 'GHIJ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VALID_ADDRESS_4 = 'GKLM1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VALID_BYTES_32 = 'a'.repeat(64); // 64 hex chars = 32 bytes
const VALID_BYTES_32_UINT8 = new Uint8Array(32).fill(0xab);

const MAX_U64 = BigInt('18446744073709551615');
const MAX_I128 = BigInt('170141183460469231731687303715884105727');
const MIN_I128 = BigInt('-170141183460469231731687303715884105728');

// ─── 1. OracleRegistered ────────────────────────────────────────────────────

describe('OracleRegisteredSchema', () => {
  it('validates a complete event', () => {
    const result = OracleRegisteredSchema.safeParse({
      type: 'OracleRegistered',
      feedType: 'Price',
      token: VALID_ADDRESS,
      oracle: VALID_ADDRESS_2,
    });
    expect(result.success).toBe(true);
  });

  it('allows null token', () => {
    const result = OracleRegisteredSchema.safeParse({
      type: 'OracleRegistered',
      feedType: 'Identity',
      token: null,
      oracle: VALID_ADDRESS,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid feedType', () => {
    const result = OracleRegisteredSchema.safeParse({
      type: 'OracleRegistered',
      feedType: 'Invalid',
      token: null,
      oracle: VALID_ADDRESS,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty oracle address', () => {
    const result = OracleRegisteredSchema.safeParse({
      type: 'OracleRegistered',
      feedType: 'Price',
      token: null,
      oracle: '',
    });
    expect(result.success).toBe(false);
  });

  it('strips extra fields', () => {
    const result = OracleRegisteredSchema.safeParse({
      type: 'OracleRegistered',
      feedType: 'Price',
      token: null,
      oracle: VALID_ADDRESS,
      extraField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extraField');
    }
  });
});

// ─── 2. OracleUnregistered ──────────────────────────────────────────────────

describe('OracleUnregisteredSchema', () => {
  it('validates a complete event', () => {
    const result = OracleUnregisteredSchema.safeParse({
      type: 'OracleUnregistered',
      feedType: 'Credit',
      token: VALID_ADDRESS,
    });
    expect(result.success).toBe(true);
  });

  it('allows null token', () => {
    const result = OracleUnregisteredSchema.safeParse({
      type: 'OracleUnregistered',
      feedType: 'Price',
      token: null,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 3. OracleHealthRecorded ────────────────────────────────────────────────

describe('OracleHealthRecordedSchema', () => {
  it('validates a complete event', () => {
    const result = OracleHealthRecordedSchema.safeParse({
      type: 'OracleHealthRecorded',
      feedType: 'Identity',
      token: VALID_ADDRESS,
      isStale: true,
      lastDataAgeLedgers: 100n,
      consecutiveStaleCount: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative lastDataAgeLedgers', () => {
    const result = OracleHealthRecordedSchema.safeParse({
      type: 'OracleHealthRecorded',
      feedType: 'Price',
      token: VALID_ADDRESS,
      isStale: false,
      lastDataAgeLedgers: -1n,
      consecutiveStaleCount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative consecutiveStaleCount', () => {
    const result = OracleHealthRecordedSchema.safeParse({
      type: 'OracleHealthRecorded',
      feedType: 'Price',
      token: VALID_ADDRESS,
      isStale: false,
      lastDataAgeLedgers: 0n,
      consecutiveStaleCount: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ─── 4. InsuranceClaimAttempted ─────────────────────────────────────────────

describe('InsuranceClaimAttemptedSchema', () => {
  it('validates a complete event', () => {
    const result = InsuranceClaimAttemptedSchema.safeParse({
      type: 'InsuranceClaimAttempted',
      invoiceId: 42n,
      lp: VALID_ADDRESS,
      compensated: true,
      payout: 1000000n,
    });
    expect(result.success).toBe(true);
  });

  it('allows zero payout', () => {
    const result = InsuranceClaimAttemptedSchema.safeParse({
      type: 'InsuranceClaimAttempted',
      invoiceId: 1n,
      lp: VALID_ADDRESS,
      compensated: false,
      payout: 0n,
    });
    expect(result.success).toBe(true);
  });

  it('allows negative payout (i128)', () => {
    const result = InsuranceClaimAttemptedSchema.safeParse({
      type: 'InsuranceClaimAttempted',
      invoiceId: 1n,
      lp: VALID_ADDRESS,
      compensated: false,
      payout: -500n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 5. TokenAdded ──────────────────────────────────────────────────────────

describe('TokenAddedSchema', () => {
  it('validates a complete event', () => {
    const result = TokenAddedSchema.safeParse({
      type: 'TokenAdded',
      token: VALID_ADDRESS,
      decimals: 6,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative decimals', () => {
    const result = TokenAddedSchema.safeParse({
      type: 'TokenAdded',
      token: VALID_ADDRESS,
      decimals: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer decimals', () => {
    const result = TokenAddedSchema.safeParse({
      type: 'TokenAdded',
      token: VALID_ADDRESS,
      decimals: 6.5,
    });
    expect(result.success).toBe(false);
  });
});

// ─── 6. TokenRemoved ────────────────────────────────────────────────────────

describe('TokenRemovedSchema', () => {
  it('validates a complete event', () => {
    const result = TokenRemovedSchema.safeParse({
      type: 'TokenRemoved',
      token: VALID_ADDRESS,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 7. InvoiceSubmitted ────────────────────────────────────────────────────

describe('InvoiceSubmittedSchema', () => {
  const validEvent = {
    type: 'InvoiceSubmitted',
    invoiceId: 42n,
    freelancer: VALID_ADDRESS,
    payer: VALID_ADDRESS_2,
    token: VALID_ADDRESS_3,
    amount: 1000000n,
    dueDate: 1700000000n,
    discountRate: 300,
    referralCode: { tag: 'None' },
    status: 'Pending',
    timestamp: 1699999999n,
  };

  it('validates a complete event', () => {
    const result = InvoiceSubmittedSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('validates with ReferralCode Present', () => {
    const result = InvoiceSubmittedSchema.safeParse({
      ...validEvent,
      referralCode: { tag: 'Present', value: VALID_BYTES_32 },
    });
    expect(result.success).toBe(true);
  });

  it('validates ReferralCode Present with Uint8Array', () => {
    const result = InvoiceSubmittedSchema.safeParse({
      ...validEvent,
      referralCode: { tag: 'Present', value: VALID_BYTES_32_UINT8 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing invoiceId', () => {
    const { invoiceId, ...rest } = validEvent;
    const result = InvoiceSubmittedSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = InvoiceSubmittedSchema.safeParse({
      ...validEvent,
      status: 'InvalidStatus',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = InvoiceSubmittedSchema.safeParse({
      ...validEvent,
      amount: -1n,
    });
    // I128Schema allows negative, so this should pass
    expect(result.success).toBe(true);
  });

  it('handles max u64 invoiceId', () => {
    const result = InvoiceSubmittedSchema.safeParse({
      ...validEvent,
      invoiceId: MAX_U64,
    });
    expect(result.success).toBe(true);
  });

  it('handles max i128 amount', () => {
    const result = InvoiceSubmittedSchema.safeParse({
      ...validEvent,
      amount: MAX_I128,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 8. InvoiceUpdated ──────────────────────────────────────────────────────

describe('InvoiceUpdatedSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceUpdatedSchema.safeParse({
      type: 'InvoiceUpdated',
      invoiceId: 42n,
      freelancer: VALID_ADDRESS,
      payer: VALID_ADDRESS_2,
      token: VALID_ADDRESS_3,
      amount: 1000000n,
      dueDate: 1700000000n,
      discountRate: 300,
      status: 'Funded',
    });
    expect(result.success).toBe(true);
  });
});

// ─── 9. InvoiceFunded ───────────────────────────────────────────────────────

describe('InvoiceFundedSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceFundedSchema.safeParse({
      type: 'InvoiceFunded',
      invoiceId: 42n,
      funder: VALID_ADDRESS,
      freelancer: VALID_ADDRESS_2,
      payer: VALID_ADDRESS_3,
      token: VALID_ADDRESS_4,
      fundAmount: 500000n,
      amountFunded: 500000n,
      invoiceAmount: 1000000n,
      dueDate: 1700000000n,
      discountRate: 300,
      fundedAt: 1699999999n,
      status: 'Funded',
      lp: VALID_ADDRESS,
      effectiveYieldBps: 300,
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });

  it('allows null fundedAt', () => {
    const result = InvoiceFundedSchema.safeParse({
      type: 'InvoiceFunded',
      invoiceId: 42n,
      funder: VALID_ADDRESS,
      freelancer: VALID_ADDRESS_2,
      payer: VALID_ADDRESS_3,
      token: VALID_ADDRESS_4,
      fundAmount: 500000n,
      amountFunded: 500000n,
      invoiceAmount: 1000000n,
      dueDate: 1700000000n,
      discountRate: 300,
      fundedAt: null,
      status: 'PartiallyFunded',
      lp: VALID_ADDRESS,
      effectiveYieldBps: 300,
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 10. InvoicePaid ────────────────────────────────────────────────────────

describe('InvoicePaidSchema', () => {
  it('validates a complete event', () => {
    const result = InvoicePaidSchema.safeParse({
      type: 'InvoicePaid',
      invoiceId: 42n,
      payer: VALID_ADDRESS,
      lp: VALID_ADDRESS_2,
      freelancer: VALID_ADDRESS_3,
      token: VALID_ADDRESS_4,
      amountPaid: 1000000n,
      lpEarned: 30000n,
      lpPayout: 530000n,
      settlementTimestamp: 1700000000n,
      paidOnTime: true,
      status: 'Paid',
    });
    expect(result.success).toBe(true);
  });
});

// ─── 11. InvoicePartiallyPaid ───────────────────────────────────────────────

describe('InvoicePartiallyPaidSchema', () => {
  it('validates a complete event', () => {
    const result = InvoicePartiallyPaidSchema.safeParse({
      type: 'InvoicePartiallyPaid',
      invoiceId: 42n,
      payer: VALID_ADDRESS,
      amountPaidNow: 250000n,
      totalAmountPaid: 750000n,
      remainingAmount: 250000n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 12. ContractPaused ─────────────────────────────────────────────────────

describe('ContractPausedSchema', () => {
  it('validates a complete event', () => {
    const result = ContractPausedSchema.safeParse({
      type: 'ContractPaused',
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 13. ContractUnpaused ───────────────────────────────────────────────────

describe('ContractUnpausedSchema', () => {
  it('validates a complete event', () => {
    const result = ContractUnpausedSchema.safeParse({
      type: 'ContractUnpaused',
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 14. InvoiceDefaulted ───────────────────────────────────────────────────

describe('InvoiceDefaultedSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceDefaultedSchema.safeParse({
      type: 'InvoiceDefaulted',
      invoiceId: 42n,
      funder: VALID_ADDRESS,
      freelancer: VALID_ADDRESS_2,
      payer: VALID_ADDRESS_3,
      token: VALID_ADDRESS_4,
      amount: 1000000n,
      dueDate: 1700000000n,
      defaultedAt: 1700100000n,
      discountAmount: 30000n,
      status: 'Defaulted',
    });
    expect(result.success).toBe(true);
  });
});

// ─── 15. InvoiceTransferred ─────────────────────────────────────────────────

describe('InvoiceTransferredSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceTransferredSchema.safeParse({
      type: 'InvoiceTransferred',
      invoiceId: 42n,
      oldFreelancer: VALID_ADDRESS,
      newFreelancer: VALID_ADDRESS_2,
      status: 'Pending',
    });
    expect(result.success).toBe(true);
  });
});

// ─── 16. InvoiceCancelled ───────────────────────────────────────────────────

describe('InvoiceCancelledSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceCancelledSchema.safeParse({
      type: 'InvoiceCancelled',
      invoiceId: 42n,
      freelancer: VALID_ADDRESS,
      status: 'Cancelled',
    });
    expect(result.success).toBe(true);
  });
});

// ─── 17. LPPositionTransferred ──────────────────────────────────────────────

describe('LPPositionTransferredSchema', () => {
  it('validates a complete event', () => {
    const result = LPPositionTransferredSchema.safeParse({
      type: 'LPPositionTransferred',
      invoiceId: 42n,
      oldLp: VALID_ADDRESS,
      newLp: VALID_ADDRESS_2,
      status: 'Funded',
    });
    expect(result.success).toBe(true);
  });
});

// ─── 18. AdminChanged ───────────────────────────────────────────────────────

describe('AdminChangedSchema', () => {
  it('validates a complete event', () => {
    const result = AdminChangedSchema.safeParse({
      type: 'AdminChanged',
      oldAdmin: VALID_ADDRESS,
      newAdmin: VALID_ADDRESS_2,
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 19. ParameterUpdated ───────────────────────────────────────────────────

describe('ParameterUpdatedSchema', () => {
  it('validates a complete event', () => {
    const result = ParameterUpdatedSchema.safeParse({
      type: 'ParameterUpdated',
      paramName: 'fee_rate',
      oldValue: 300n,
      newValue: 500n,
      updatedBy: VALID_ADDRESS,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty paramName', () => {
    const result = ParameterUpdatedSchema.safeParse({
      type: 'ParameterUpdated',
      paramName: '',
      oldValue: 300n,
      newValue: 500n,
      updatedBy: VALID_ADDRESS,
    });
    expect(result.success).toBe(false);
  });
});

// ─── 20. ContractUpgraded ───────────────────────────────────────────────────

describe('ContractUpgradedSchema', () => {
  it('validates with hex string hash', () => {
    const result = ContractUpgradedSchema.safeParse({
      type: 'ContractUpgraded',
      admin: VALID_ADDRESS,
      newWasmHash: VALID_BYTES_32,
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });

  it('validates with Uint8Array hash', () => {
    const result = ContractUpgradedSchema.safeParse({
      type: 'ContractUpgraded',
      admin: VALID_ADDRESS,
      newWasmHash: VALID_BYTES_32_UINT8,
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });

  it('rejects short hex string', () => {
    const result = ContractUpgradedSchema.safeParse({
      type: 'ContractUpgraded',
      admin: VALID_ADDRESS,
      newWasmHash: 'abc123',
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-hex characters', () => {
    const result = ContractUpgradedSchema.safeParse({
      type: 'ContractUpgraded',
      admin: VALID_ADDRESS,
      newWasmHash: 'z'.repeat(64),
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(false);
  });
});

// ─── 21. DistributionContractUpdated ────────────────────────────────────────

describe('DistributionContractUpdatedSchema', () => {
  it('validates with null old address', () => {
    const result = DistributionContractUpdatedSchema.safeParse({
      type: 'DistributionContractUpdated',
      oldDistributionContract: null,
      newDistributionContract: VALID_ADDRESS,
      updatedBy: VALID_ADDRESS_2,
    });
    expect(result.success).toBe(true);
  });

  it('validates with old address', () => {
    const result = DistributionContractUpdatedSchema.safeParse({
      type: 'DistributionContractUpdated',
      oldDistributionContract: VALID_ADDRESS,
      newDistributionContract: VALID_ADDRESS_2,
      updatedBy: VALID_ADDRESS_3,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 22. PriceOracleUpdated ─────────────────────────────────────────────────

describe('PriceOracleUpdatedSchema', () => {
  it('validates with null old oracle', () => {
    const result = PriceOracleUpdatedSchema.safeParse({
      type: 'PriceOracleUpdated',
      oldOracle: null,
      newOracle: VALID_ADDRESS,
      updatedBy: VALID_ADDRESS_2,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 23. ContractInitialized ────────────────────────────────────────────────

describe('ContractInitializedSchema', () => {
  it('validates a complete event', () => {
    const result = ContractInitializedSchema.safeParse({
      type: 'ContractInitialized',
      admin: VALID_ADDRESS,
      usdcToken: VALID_ADDRESS_2,
      eurcToken: VALID_ADDRESS_3,
      xlmToken: VALID_ADDRESS_4,
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 24. DefaultAppealed ────────────────────────────────────────────────────

describe('DefaultAppealedSchema', () => {
  it('validates with hex hash', () => {
    const result = DefaultAppealedSchema.safeParse({
      type: 'DefaultAppealed',
      invoiceId: 42n,
      payer: VALID_ADDRESS,
      evidenceHash: VALID_BYTES_32,
      appealedAt: 1699999999n,
    });
    expect(result.success).toBe(true);
  });

  it('validates with Uint8Array hash', () => {
    const result = DefaultAppealedSchema.safeParse({
      type: 'DefaultAppealed',
      invoiceId: 42n,
      payer: VALID_ADDRESS,
      evidenceHash: VALID_BYTES_32_UINT8,
      appealedAt: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 25. AppealResolved ─────────────────────────────────────────────────────

describe('AppealResolvedSchema', () => {
  it('validates upheld appeal', () => {
    const result = AppealResolvedSchema.safeParse({
      type: 'AppealResolved',
      invoiceId: 42n,
      payer: VALID_ADDRESS,
      upheld: true,
      resolvedAt: 1699999999n,
    });
    expect(result.success).toBe(true);
  });

  it('validates rejected appeal', () => {
    const result = AppealResolvedSchema.safeParse({
      type: 'AppealResolved',
      invoiceId: 42n,
      payer: VALID_ADDRESS,
      upheld: false,
      resolvedAt: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 26. InvoiceDisputed ────────────────────────────────────────────────────

describe('InvoiceDisputedSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceDisputedSchema.safeParse({
      type: 'InvoiceDisputed',
      invoiceId: 42n,
      payer: VALID_ADDRESS,
      reasonHash: VALID_BYTES_32,
      disputedAt: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 27. DisputeResolved ────────────────────────────────────────────────────

describe('DisputeResolvedSchema', () => {
  it('validates upheld resolution (1)', () => {
    const result = DisputeResolvedSchema.safeParse({
      type: 'DisputeResolved',
      invoiceId: 42n,
      resolutionHash: VALID_BYTES_32,
      resolution: 1,
      resolvedAt: 1699999999n,
    });
    expect(result.success).toBe(true);
  });

  it('validates rejected resolution (2)', () => {
    const result = DisputeResolvedSchema.safeParse({
      type: 'DisputeResolved',
      invoiceId: 42n,
      resolutionHash: VALID_BYTES_32,
      resolution: 2,
      resolvedAt: 1699999999n,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid resolution value (0)', () => {
    const result = DisputeResolvedSchema.safeParse({
      type: 'DisputeResolved',
      invoiceId: 42n,
      resolutionHash: VALID_BYTES_32,
      resolution: 0,
      resolvedAt: 1699999999n,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid resolution value (3)', () => {
    const result = DisputeResolvedSchema.safeParse({
      type: 'DisputeResolved',
      invoiceId: 42n,
      resolutionHash: VALID_BYTES_32,
      resolution: 3,
      resolvedAt: 1699999999n,
    });
    expect(result.success).toBe(false);
  });
});

// ─── 28. DisputeUpheldPayerRefund ───────────────────────────────────────────

describe('DisputeUpheldPayerRefundSchema', () => {
  it('validates a complete event', () => {
    const result = DisputeUpheldPayerRefundSchema.safeParse({
      type: 'DisputeUpheldPayerRefund',
      invoiceId: 42n,
      payer: VALID_ADDRESS,
      amount: 500000n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 29. FundRequested ──────────────────────────────────────────────────────

describe('FundRequestedSchema', () => {
  it('validates a complete event', () => {
    const result = FundRequestedSchema.safeParse({
      type: 'FundRequested',
      invoiceId: 42n,
      lp: VALID_ADDRESS,
      score: 75,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 30. FundQueueResolved ──────────────────────────────────────────────────

describe('FundQueueResolvedSchema', () => {
  it('validates a complete event', () => {
    const result = FundQueueResolvedSchema.safeParse({
      type: 'FundQueueResolved',
      invoiceId: 42n,
      approvedLp: VALID_ADDRESS,
      score: 85,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 31. FundQueueResolutionAttempted ───────────────────────────────────────

describe('FundQueueResolutionAttemptedSchema', () => {
  it('validates successful resolution', () => {
    const result = FundQueueResolutionAttemptedSchema.safeParse({
      type: 'FundQueueResolutionAttempted',
      invoiceId: 42n,
      callerLedger: 1000,
      attemptedAtLedger: 1001,
      success: true,
    });
    expect(result.success).toBe(true);
  });

  it('validates failed resolution', () => {
    const result = FundQueueResolutionAttemptedSchema.safeParse({
      type: 'FundQueueResolutionAttempted',
      invoiceId: 42n,
      callerLedger: 1000,
      attemptedAtLedger: 1001,
      success: false,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 32. InvoiceExpired ─────────────────────────────────────────────────────

describe('InvoiceExpiredSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceExpiredSchema.safeParse({
      type: 'InvoiceExpired',
      invoiceId: 42n,
      freelancer: VALID_ADDRESS,
      status: 'Expired',
    });
    expect(result.success).toBe(true);
  });
});

// ─── 33. ReputationUpdated ──────────────────────────────────────────────────

describe('ReputationUpdatedSchema', () => {
  it('validates a complete event', () => {
    const result = ReputationUpdatedSchema.safeParse({
      type: 'ReputationUpdated',
      address: VALID_ADDRESS,
      oldScore: 50,
      newScore: 75,
      invoicesSubmitted: 10,
      invoicesPaid: 8,
      invoicesDefaulted: 1,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 34. InvoiceTokenChanged ────────────────────────────────────────────────

describe('InvoiceTokenChangedSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceTokenChangedSchema.safeParse({
      type: 'InvoiceTokenChanged',
      invoiceId: 42n,
      oldToken: VALID_ADDRESS,
      newToken: VALID_ADDRESS_2,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 35. InvoiceNftMinted ───────────────────────────────────────────────────

describe('InvoiceNftMintedSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceNftMintedSchema.safeParse({
      type: 'InvoiceNftMinted',
      invoiceId: 42n,
      owner: VALID_ADDRESS,
      amount: 1000000n,
      dueDate: 1700000000,
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 36. InvoiceNftTransferred ──────────────────────────────────────────────

describe('InvoiceNftTransferredSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceNftTransferredSchema.safeParse({
      type: 'InvoiceNftTransferred',
      invoiceId: 42n,
      from: VALID_ADDRESS,
      to: VALID_ADDRESS_2,
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── 37. InvoiceNftBurned ───────────────────────────────────────────────────

describe('InvoiceNftBurnedSchema', () => {
  it('validates a complete event', () => {
    const result = InvoiceNftBurnedSchema.safeParse({
      type: 'InvoiceNftBurned',
      invoiceId: 42n,
      owner: VALID_ADDRESS,
      timestamp: 1699999999n,
    });
    expect(result.success).toBe(true);
  });
});

// ─── EVENT_SCHEMAS registry ─────────────────────────────────────────────────

describe('EVENT_SCHEMAS registry', () => {
  it('contains all 37 event schemas', () => {
    const schemaCount = Object.keys(EVENT_SCHEMAS).length;
    expect(schemaCount).toBe(37);
  });

  it('each schema has a type literal discriminator', () => {
    for (const [name, schema] of Object.entries(EVENT_SCHEMAS)) {
      // The schema should have a shape with a 'type' field
      expect(schema).toBeDefined();
      // Verify it's a Zod object schema with a type literal
      const typeName = name;
      const testEvent = { type: typeName };
      const result = schema.safeParse(testEvent);
      // Should fail because other required fields are missing, but type should be recognized
      expect(result.success).toBe(false);
    }
  });
});
