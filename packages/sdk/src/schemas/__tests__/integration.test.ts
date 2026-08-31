/**
 * packages/sdk/src/schemas/__tests__/integration.test.ts
 *
 * Integration tests for the event validation middleware.
 * Tests the full flow from raw event → parsing → validation → handler.
 */

import { validateEvent } from '../validateEvent';
import { EVENT_SCHEMAS, SCHEMA_VERSION } from '../events';
import type { ValidatedContractEvent } from '../events';

// ─── Mock raw events (simulating what comes from Soroban RPC) ────────────────

const VALID_ADDRESS = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VALID_ADDRESS_2 = 'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Create a mock validated event for each event type.
 * These represent the output of successful validation.
 */
function createMockEvent(type: string): Record<string, unknown> {
  switch (type) {
    case 'OracleRegistered':
      return {
        type,
        feedType: 'Price',
        token: VALID_ADDRESS,
        oracle: VALID_ADDRESS_2,
      };
    case 'OracleUnregistered':
      return {
        type,
        feedType: 'Price',
        token: VALID_ADDRESS,
      };
    case 'OracleHealthRecorded':
      return {
        type,
        feedType: 'Price',
        token: VALID_ADDRESS,
        isStale: false,
        lastDataAgeLedgers: 10n,
        consecutiveStaleCount: 0,
      };
    case 'InsuranceClaimAttempted':
      return {
        type,
        invoiceId: 1n,
        lp: VALID_ADDRESS,
        compensated: true,
        payout: 1000n,
      };
    case 'TokenAdded':
      return {
        type,
        token: VALID_ADDRESS,
        decimals: 6,
      };
    case 'TokenRemoved':
      return {
        type,
        token: VALID_ADDRESS,
      };
    case 'InvoiceSubmitted':
      return {
        type,
        invoiceId: 42n,
        freelancer: VALID_ADDRESS,
        payer: VALID_ADDRESS_2,
        token: VALID_ADDRESS,
        amount: 1000000n,
        dueDate: 1700000000n,
        discountRate: 300,
        referralCode: { tag: 'None' },
        status: 'Pending',
        timestamp: 1699999999n,
      };
    case 'InvoiceUpdated':
      return {
        type,
        invoiceId: 42n,
        freelancer: VALID_ADDRESS,
        payer: VALID_ADDRESS_2,
        token: VALID_ADDRESS,
        amount: 1000000n,
        dueDate: 1700000000n,
        discountRate: 300,
        status: 'Funded',
      };
    case 'InvoiceFunded':
      return {
        type,
        invoiceId: 42n,
        funder: VALID_ADDRESS,
        freelancer: VALID_ADDRESS_2,
        payer: VALID_ADDRESS,
        token: VALID_ADDRESS_2,
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
      };
    case 'InvoicePaid':
      return {
        type,
        invoiceId: 42n,
        payer: VALID_ADDRESS,
        lp: VALID_ADDRESS_2,
        freelancer: VALID_ADDRESS,
        token: VALID_ADDRESS_2,
        amountPaid: 1000000n,
        lpEarned: 30000n,
        lpPayout: 530000n,
        settlementTimestamp: 1700000000n,
        paidOnTime: true,
        status: 'Paid',
      };
    case 'InvoicePartiallyPaid':
      return {
        type,
        invoiceId: 42n,
        payer: VALID_ADDRESS,
        amountPaidNow: 250000n,
        totalAmountPaid: 750000n,
        remainingAmount: 250000n,
      };
    case 'ContractPaused':
      return { type, timestamp: 1699999999n };
    case 'ContractUnpaused':
      return { type, timestamp: 1699999999n };
    case 'InvoiceDefaulted':
      return {
        type,
        invoiceId: 42n,
        funder: VALID_ADDRESS,
        freelancer: VALID_ADDRESS_2,
        payer: VALID_ADDRESS,
        token: VALID_ADDRESS_2,
        amount: 1000000n,
        dueDate: 1700000000n,
        defaultedAt: 1700100000n,
        discountAmount: 30000n,
        status: 'Defaulted',
      };
    case 'InvoiceTransferred':
      return {
        type,
        invoiceId: 42n,
        oldFreelancer: VALID_ADDRESS,
        newFreelancer: VALID_ADDRESS_2,
        status: 'Pending',
      };
    case 'InvoiceCancelled':
      return {
        type,
        invoiceId: 42n,
        freelancer: VALID_ADDRESS,
        status: 'Cancelled',
      };
    case 'LPPositionTransferred':
      return {
        type,
        invoiceId: 42n,
        oldLp: VALID_ADDRESS,
        newLp: VALID_ADDRESS_2,
        status: 'Funded',
      };
    case 'AdminChanged':
      return {
        type,
        oldAdmin: VALID_ADDRESS,
        newAdmin: VALID_ADDRESS_2,
        timestamp: 1699999999n,
      };
    case 'ParameterUpdated':
      return {
        type,
        paramName: 'fee_rate',
        oldValue: 300n,
        newValue: 500n,
        updatedBy: VALID_ADDRESS,
      };
    case 'ContractUpgraded':
      return {
        type,
        admin: VALID_ADDRESS,
        newWasmHash: 'a'.repeat(64),
        timestamp: 1699999999n,
      };
    case 'DistributionContractUpdated':
      return {
        type,
        oldDistributionContract: null,
        newDistributionContract: VALID_ADDRESS,
        updatedBy: VALID_ADDRESS_2,
      };
    case 'PriceOracleUpdated':
      return {
        type,
        oldOracle: null,
        newOracle: VALID_ADDRESS,
        updatedBy: VALID_ADDRESS_2,
      };
    case 'ContractInitialized':
      return {
        type,
        admin: VALID_ADDRESS,
        usdcToken: VALID_ADDRESS_2,
        eurcToken: VALID_ADDRESS,
        xlmToken: VALID_ADDRESS_2,
        timestamp: 1699999999n,
      };
    case 'DefaultAppealed':
      return {
        type,
        invoiceId: 42n,
        payer: VALID_ADDRESS,
        evidenceHash: 'a'.repeat(64),
        appealedAt: 1699999999n,
      };
    case 'AppealResolved':
      return {
        type,
        invoiceId: 42n,
        payer: VALID_ADDRESS,
        upheld: true,
        resolvedAt: 1699999999n,
      };
    case 'InvoiceDisputed':
      return {
        type,
        invoiceId: 42n,
        payer: VALID_ADDRESS,
        reasonHash: 'a'.repeat(64),
        disputedAt: 1699999999n,
      };
    case 'DisputeResolved':
      return {
        type,
        invoiceId: 42n,
        resolutionHash: 'a'.repeat(64),
        resolution: 1,
        resolvedAt: 1699999999n,
      };
    case 'DisputeUpheldPayerRefund':
      return {
        type,
        invoiceId: 42n,
        payer: VALID_ADDRESS,
        amount: 500000n,
      };
    case 'FundRequested':
      return {
        type,
        invoiceId: 42n,
        lp: VALID_ADDRESS,
        score: 75,
      };
    case 'FundQueueResolved':
      return {
        type,
        invoiceId: 42n,
        approvedLp: VALID_ADDRESS,
        score: 85,
      };
    case 'FundQueueResolutionAttempted':
      return {
        type,
        invoiceId: 42n,
        callerLedger: 1000,
        attemptedAtLedger: 1001,
        success: true,
      };
    case 'InvoiceExpired':
      return {
        type,
        invoiceId: 42n,
        freelancer: VALID_ADDRESS,
        status: 'Expired',
      };
    case 'ReputationUpdated':
      return {
        type,
        address: VALID_ADDRESS,
        oldScore: 50,
        newScore: 75,
        invoicesSubmitted: 10,
        invoicesPaid: 8,
        invoicesDefaulted: 1,
      };
    case 'InvoiceTokenChanged':
      return {
        type,
        invoiceId: 42n,
        oldToken: VALID_ADDRESS,
        newToken: VALID_ADDRESS_2,
      };
    case 'InvoiceNftMinted':
      return {
        type,
        invoiceId: 42n,
        owner: VALID_ADDRESS,
        amount: 1000000n,
        dueDate: 1700000000,
        timestamp: 1699999999n,
      };
    case 'InvoiceNftTransferred':
      return {
        type,
        invoiceId: 42n,
        from: VALID_ADDRESS,
        to: VALID_ADDRESS_2,
        timestamp: 1699999999n,
      };
    case 'InvoiceNftBurned':
      return {
        type,
        invoiceId: 42n,
        owner: VALID_ADDRESS,
        timestamp: 1699999999n,
      };
    default:
      return { type };
  }
}

// ─── Integration tests ──────────────────────────────────────────────────────

describe('Integration: validateEvent with all event types', () => {
  const eventTypes = Object.keys(EVENT_SCHEMAS);

  for (const eventType of eventTypes) {
    it(`validates ${eventType} end-to-end`, () => {
      const mockEvent = createMockEvent(eventType);
      const result = validateEvent(mockEvent);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.event.type).toBe(eventType);
        expect(result.schemaVersion).toBe(SCHEMA_VERSION);
      }
    });
  }
});

describe('Integration: validation catches type errors', () => {
  it('catches string where bigint expected', () => {
    const result = validateEvent({
      type: 'InvoiceSubmitted',
      invoiceId: 'not a bigint',
      freelancer: VALID_ADDRESS,
      payer: VALID_ADDRESS,
      token: VALID_ADDRESS,
      amount: 1000n,
      dueDate: 1700000000n,
      discountRate: 300,
      referralCode: { tag: 'None' },
      status: 'Pending',
      timestamp: 1699999999n,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      const invoiceIdIssue = result.error.issues.find((i) => i.path.includes('invoiceId'));
      expect(invoiceIdIssue).toBeDefined();
    }
  });

  it('catches number where boolean expected', () => {
    const result = validateEvent({
      type: 'ContractPaused',
      timestamp: 123,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('catches invalid enum variant', () => {
    const result = validateEvent({
      type: 'InvoiceSubmitted',
      invoiceId: 42n,
      freelancer: VALID_ADDRESS,
      payer: VALID_ADDRESS,
      token: VALID_ADDRESS,
      amount: 1000n,
      dueDate: 1700000000n,
      discountRate: 300,
      referralCode: { tag: 'None' },
      status: 'InvalidStatus',
      timestamp: 1699999999n,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const statusIssue = result.error.issues.find((i) => i.path.includes('status'));
      expect(statusIssue).toBeDefined();
    }
  });

  it('catches missing required field', () => {
    const result = validateEvent({
      type: 'InvoiceSubmitted',
      invoiceId: 42n,
      // Missing freelancer, payer, token, amount, etc.
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('Integration: BytesN<32> normalization', () => {
  it('normalizes hex string to Uint8Array in validated output', () => {
    const hexHash = 'a'.repeat(64);
    const result = validateEvent({
      type: 'ContractUpgraded',
      admin: VALID_ADDRESS,
      newWasmHash: hexHash,
      timestamp: 1n,
    });

    expect(result.ok).toBe(true);
    if (result.ok && 'newWasmHash' in result.event) {
      expect(result.event.newWasmHash).toBeInstanceOf(Uint8Array);
      expect((result.event.newWasmHash as Uint8Array).length).toBe(32);
    }
  });

  it('preserves Uint8Array in validated output', () => {
    const uint8Hash = new Uint8Array(32).fill(0xab);
    const result = validateEvent({
      type: 'ContractUpgraded',
      admin: VALID_ADDRESS,
      newWasmHash: uint8Hash,
      timestamp: 1n,
    });

    expect(result.ok).toBe(true);
    if (result.ok && 'newWasmHash' in result.event) {
      expect(result.event.newWasmHash).toBeInstanceOf(Uint8Array);
    }
  });
});

describe('Integration: optional fields', () => {
  it('handles null optional fields', () => {
    const result = validateEvent({
      type: 'OracleRegistered',
      feedType: 'Price',
      token: null,
      oracle: VALID_ADDRESS,
    });

    expect(result.ok).toBe(true);
    if (result.ok && 'token' in result.event) {
      expect(result.event.token).toBeNull();
    }
  });

  it('handles present optional fields', () => {
    const result = validateEvent({
      type: 'OracleRegistered',
      feedType: 'Price',
      token: VALID_ADDRESS,
      oracle: VALID_ADDRESS,
    });

    expect(result.ok).toBe(true);
    if (result.ok && 'token' in result.event) {
      expect(result.event.token).toBe(VALID_ADDRESS);
    }
  });
});
