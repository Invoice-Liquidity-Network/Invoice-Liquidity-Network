/**
 * packages/sdk/src/schemas/__tests__/fuzz.test.ts
 *
 * Fuzz tests using fast-check to verify that:
 * 1. Valid event data always passes validation
 * 2. Random/malformed data is gracefully rejected (no crashes)
 * 3. Edge cases around BigInt boundaries are handled correctly
 */

import * as fc from 'fast-check';
import { EVENT_SCHEMAS, SCHEMA_VERSION } from '../events';
import { validateEvent, EventValidationError } from '../validateEvent';

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate a valid Stellar address string. */
const addressArb = fc.hexaString({ minLength: 56, maxLength: 56 }).map((h) => 'G' + h);

/** Generate a valid hex string for BytesN<32>. */
const bytesN32HexArb = fc.hexaString({ minLength: 64, maxLength: 64 });

/** Generate a valid Uint8Array for BytesN<32>. */
const bytesN32Uint8Arb = fc.uint8Array({ minLength: 32, maxLength: 32 });

/** Generate a valid u64 as bigint. */
const u64Arb = fc.bigInt({ min: 0n, max: BigInt('18446744073709551615') });

/** Generate a valid i128 as bigint. */
const i128Arb = fc.bigInt({
  min: BigInt('-170141183460469231731687303715884105728'),
  max: BigInt('170141183460469231731687303715884105727'),
});

/** Generate a valid u32 as number. */
const u32Arb = fc.integer({ min: 0, max: 4294967295 });

/** Generate a valid InvoiceStatus. */
const invoiceStatusArb = fc.constantFrom(
  'Pending',
  'Funded',
  'PartiallyFunded',
  'Paid',
  'Defaulted',
  'Appealed',
  'Disputed',
  'Expired',
  'Cancelled'
);

/** Generate a valid OracleFeedType. */
const oracleFeedTypeArb = fc.constantFrom('Price', 'Identity', 'Credit');

/** Generate a valid ReferralCode. */
const referralCodeArb = fc.oneof(
  fc.constant({ tag: 'None' }),
  fc.record({
    tag: fc.constant('Present'),
    value: bytesN32HexArb,
  })
);

// ─── Valid event arbitraries ────────────────────────────────────────────────

const oracleRegisteredArb = fc.record({
  type: fc.constant('OracleRegistered'),
  feedType: oracleFeedTypeArb,
  token: fc.oneof(addressArb, fc.constant(null)),
  oracle: addressArb,
});

const oracleUnregisteredArb = fc.record({
  type: fc.constant('OracleUnregistered'),
  feedType: oracleFeedTypeArb,
  token: fc.oneof(addressArb, fc.constant(null)),
});

const oracleHealthRecordedArb = fc.record({
  type: fc.constant('OracleHealthRecorded'),
  feedType: oracleFeedTypeArb,
  token: addressArb,
  isStale: fc.boolean(),
  lastDataAgeLedgers: u64Arb,
  consecutiveStaleCount: u32Arb,
});

const insuranceClaimAttemptedArb = fc.record({
  type: fc.constant('InsuranceClaimAttempted'),
  invoiceId: u64Arb,
  lp: addressArb,
  compensated: fc.boolean(),
  payout: i128Arb,
});

const tokenAddedArb = fc.record({
  type: fc.constant('TokenAdded'),
  token: addressArb,
  decimals: fc.integer({ min: 0, max: 255 }),
});

const tokenRemovedArb = fc.record({
  type: fc.constant('TokenRemoved'),
  token: addressArb,
});

const invoiceSubmittedArb = fc.record({
  type: fc.constant('InvoiceSubmitted'),
  invoiceId: u64Arb,
  freelancer: addressArb,
  payer: addressArb,
  token: addressArb,
  amount: i128Arb,
  dueDate: u64Arb,
  discountRate: u32Arb,
  referralCode: referralCodeArb,
  status: invoiceStatusArb,
  timestamp: u64Arb,
});

const contractPausedArb = fc.record({
  type: fc.constant('ContractPaused'),
  timestamp: u64Arb,
});

const contractUnpausedArb = fc.record({
  type: fc.constant('ContractUnpaused'),
  timestamp: u64Arb,
});

const invoiceCancelledArb = fc.record({
  type: fc.constant('InvoiceCancelled'),
  invoiceId: u64Arb,
  freelancer: addressArb,
  status: invoiceStatusArb,
});

const invoiceExpiredArb = fc.record({
  type: fc.constant('InvoiceExpired'),
  invoiceId: u64Arb,
  freelancer: addressArb,
  status: invoiceStatusArb,
});

const fundRequestedArb = fc.record({
  type: fc.constant('FundRequested'),
  invoiceId: u64Arb,
  lp: addressArb,
  score: u32Arb,
});

const fundQueueResolvedArb = fc.record({
  type: fc.constant('FundQueueResolved'),
  invoiceId: u64Arb,
  approvedLp: addressArb,
  score: u32Arb,
});

const fundQueueResolutionAttemptedArb = fc.record({
  type: fc.constant('FundQueueResolutionAttempted'),
  invoiceId: u64Arb,
  callerLedger: u32Arb,
  attemptedAtLedger: u32Arb,
  success: fc.boolean(),
});

const adminChangedArb = fc.record({
  type: fc.constant('AdminChanged'),
  oldAdmin: addressArb,
  newAdmin: addressArb,
  timestamp: u64Arb,
});

const reputationUpdatedArb = fc.record({
  type: fc.constant('ReputationUpdated'),
  address: addressArb,
  oldScore: u32Arb,
  newScore: u32Arb,
  invoicesSubmitted: u32Arb,
  invoicesPaid: u32Arb,
  invoicesDefaulted: u32Arb,
});

const invoiceTokenChangedArb = fc.record({
  type: fc.constant('InvoiceTokenChanged'),
  invoiceId: u64Arb,
  oldToken: addressArb,
  newToken: addressArb,
});

const invoiceNftMintedArb = fc.record({
  type: fc.constant('InvoiceNftMinted'),
  invoiceId: u64Arb,
  owner: addressArb,
  amount: i128Arb,
  dueDate: u32Arb,
  timestamp: u64Arb,
});

const invoiceNftTransferredArb = fc.record({
  type: fc.constant('InvoiceNftTransferred'),
  invoiceId: u64Arb,
  from: addressArb,
  to: addressArb,
  timestamp: u64Arb,
});

const invoiceNftBurnedArb = fc.record({
  type: fc.constant('InvoiceNftBurned'),
  invoiceId: u64Arb,
  owner: addressArb,
  timestamp: u64Arb,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Fuzz: valid events always pass', () => {
  const validEventArbitraries = [
    { name: 'OracleRegistered', arb: oracleRegisteredArb },
    { name: 'OracleUnregistered', arb: oracleUnregisteredArb },
    { name: 'OracleHealthRecorded', arb: oracleHealthRecordedArb },
    { name: 'InsuranceClaimAttempted', arb: insuranceClaimAttemptedArb },
    { name: 'TokenAdded', arb: tokenAddedArb },
    { name: 'TokenRemoved', arb: tokenRemovedArb },
    { name: 'InvoiceSubmitted', arb: invoiceSubmittedArb },
    { name: 'ContractPaused', arb: contractPausedArb },
    { name: 'ContractUnpaused', arb: contractUnpausedArb },
    { name: 'InvoiceCancelled', arb: invoiceCancelledArb },
    { name: 'InvoiceExpired', arb: invoiceExpiredArb },
    { name: 'FundRequested', arb: fundRequestedArb },
    { name: 'FundQueueResolved', arb: fundQueueResolvedArb },
    { name: 'FundQueueResolutionAttempted', arb: fundQueueResolutionAttemptedArb },
    { name: 'AdminChanged', arb: adminChangedArb },
    { name: 'ReputationUpdated', arb: reputationUpdatedArb },
    { name: 'InvoiceTokenChanged', arb: invoiceTokenChangedArb },
    { name: 'InvoiceNftMinted', arb: invoiceNftMintedArb },
    { name: 'InvoiceNftTransferred', arb: invoiceNftTransferredArb },
    { name: 'InvoiceNftBurned', arb: invoiceNftBurnedArb },
  ];

  for (const { name, arb } of validEventArbitraries) {
    it(`validates random ${name} events`, () => {
      fc.assert(
        fc.property(arb, (event) => {
          const result = validateEvent(event);
          expect(result.ok).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  }
});

describe('Fuzz: malformed data is gracefully rejected', () => {
  it('rejects random non-object data without crashing', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.float(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.array(fc.anything()),
          fc.hexaString()
        ),
        (data) => {
          const result = validateEvent(data);
          // Should always return a result, never throw
          expect(result).toBeDefined();
          expect(typeof result.ok).toBe('boolean');
          if (!result.ok) {
            expect(result.error).toBeInstanceOf(EventValidationError);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('rejects random objects with wrong field types', () => {
    fc.assert(
      fc.property(
        fc.record({
          type: fc.constantFrom(...Object.keys(EVENT_SCHEMAS)),
          // Random values for all other fields
          data: fc.dictionary(fc.string(), fc.anything()),
        }),
        ({ type, data }) => {
          const event = { type, ...data };
          const result = validateEvent(event);
          // Should return a result, not throw
          expect(result).toBeDefined();
          expect(typeof result.ok).toBe('boolean');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects objects with missing type field', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.anything()), (data) => {
        const result = validateEvent(data);
        expect(result).toBeDefined();
        expect(typeof result.ok).toBe('boolean');
      }),
      { numRuns: 100 }
    );
  });

  it('rejects objects with unknown event type', () => {
    fc.assert(
      fc.property(fc.hexaString({ minLength: 5, maxLength: 20 }), (typeName) => {
        const event = { type: typeName, data: 'test' };
        const result = validateEvent(event);
        expect(result).toBeDefined();
        expect(typeof result.ok).toBe('boolean');
        if (!result.ok) {
          expect(result.error.eventType).toBe(typeName);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Fuzz: BigInt edge cases', () => {
  it('handles u64 boundary values', () => {
    const boundaryValues = [
      0n,
      1n,
      BigInt('18446744073709551614'), // MAX_U64 - 1
      BigInt('18446744073709551615'), // MAX_U64
    ];

    for (const value of boundaryValues) {
      const event = {
        type: 'ContractPaused',
        timestamp: value,
      };
      const result = validateEvent(event);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects negative u64 values', () => {
    const event = {
      type: 'ContractPaused',
      timestamp: -1n,
    };
    const result = validateEvent(event);
    expect(result.ok).toBe(false);
  });

  it('handles i128 boundary values', () => {
    const boundaryValues = [
      0n,
      1n,
      BigInt('170141183460469231731687303715884105727'), // MAX_I128
      BigInt('-170141183460469231731687303715884105728'), // MIN_I128
    ];

    for (const value of boundaryValues) {
      const event = {
        type: 'InsuranceClaimAttempted',
        invoiceId: 1n,
        lp: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        compensated: false,
        payout: value,
      };
      const result = validateEvent(event);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects BigInt values that exceed i128 range', () => {
    const tooLarge = BigInt('170141183460469231731687303715884105728'); // MAX_I128 + 1
    const event = {
      type: 'InsuranceClaimAttempted',
      invoiceId: 1n,
      lp: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      compensated: false,
      payout: tooLarge,
    };
    const result = validateEvent(event);
    expect(result.ok).toBe(false);
  });
});

describe('Fuzz: BytesN<32> normalization', () => {
  it('normalizes hex strings to Uint8Array', () => {
    fc.assert(
      fc.property(bytesN32HexArb, (hex) => {
        const event = {
          type: 'ContractUpgraded',
          admin: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          newWasmHash: hex,
          timestamp: 1n,
        };
        const result = validateEvent(event);
        expect(result.ok).toBe(true);
        if (result.ok && 'newWasmHash' in result.event) {
          expect(result.event.newWasmHash).toBeInstanceOf(Uint8Array);
          expect((result.event.newWasmHash as Uint8Array).length).toBe(32);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('preserves Uint8Array input', () => {
    const event = {
      type: 'ContractUpgraded',
      admin: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      newWasmHash: new Uint8Array(32).fill(0xab),
      timestamp: 1n,
    };
    const result = validateEvent(event);
    expect(result.ok).toBe(true);
    if (result.ok && 'newWasmHash' in result.event) {
      expect(result.event.newWasmHash).toBeInstanceOf(Uint8Array);
    }
  });
});

describe('Fuzz: extra fields are stripped', () => {
  it('strips unknown fields from valid events', () => {
    fc.assert(
      fc.property(
        fc.record({
          type: fc.constant('ContractPaused'),
          timestamp: u64Arb,
          extraField1: fc.string(),
          extraField2: fc.integer(),
          nested: fc.record({ deep: fc.boolean() }),
        }),
        (event) => {
          const result = validateEvent(event);
          expect(result.ok).toBe(true);
          if (result.ok) {
            const keys = Object.keys(result.event);
            expect(keys).toContain('type');
            expect(keys).toContain('timestamp');
            expect(keys).not.toContain('extraField1');
            expect(keys).not.toContain('extraField2');
            expect(keys).not.toContain('nested');
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
