import { nativeToScVal, xdr, Keypair } from '@stellar/stellar-sdk';

import {
  parseContractEvent,
  parseInvoiceSubmittedEvent,
  parseInvoiceFundedEvent,
  parseInvoicePaidEvent,
  parseInvoiceCancelledEvent,
  parseInvoiceExpiredEvent,
  parseInvoiceDisputedEvent,
  parseReputationUpdatedEvent,
  parseContractPausedEvent,
  parseTokenAddedEvent,
  parseLPPositionTransferredEvent,
  supportedEventTypes,
  type RawEvent,
  type ContractEvent,
} from './events';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const TEST_PUBLIC_KEY = Keypair.random().publicKey();
const TEST_ISSUER = Keypair.random().publicKey();
const TEST_FUNDER = Keypair.random().publicKey();
const TEST_PAYER = Keypair.random().publicKey();
const TEST_DISPUTER = Keypair.random().publicKey();
const TEST_FROM = Keypair.random().publicKey();
const TEST_TO = Keypair.random().publicKey();
const TEST_TOKEN = Keypair.random().publicKey();
const TEST_ADDRESS = Keypair.random().publicKey();

function sym(name: string): xdr.ScVal {
  return nativeToScVal(name, { type: 'symbol' });
}

function u64(val: bigint | number): xdr.ScVal {
  return nativeToScVal(val, { type: 'u64' });
}

function i128(val: bigint): xdr.ScVal {
  return nativeToScVal(val, { type: 'i128' });
}

function u32(val: number): xdr.ScVal {
  return nativeToScVal(val, { type: 'u32' });
}

function addressScVal(addr: string): xdr.ScVal {
  return nativeToScVal(addr, { type: 'address' });
}

function scvMap(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(entries).map(([key, val]) => new xdr.ScMapEntry({ key: sym(key), val }))
  );
}

const TIMESTAMP = 1_700_000_000n;
const INVOICE_ID = 42n;
const AMOUNT = 10_000_000_000n;
const SCORE = 85;

function makeRawEvent(topics: xdr.ScVal[], value: xdr.ScVal): RawEvent {
  return { topics, value };
}

function valueWith(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return scvMap({ timestamp: u64(TIMESTAMP), ...fields });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseInvoiceSubmittedEvent', () => {
  it('parses a valid InvoiceSubmitted event', () => {
    const raw = makeRawEvent(
      [sym('invoice_submitted'), u64(INVOICE_ID), addressScVal(TEST_ISSUER)],
      valueWith({ amount: i128(AMOUNT) })
    );

    const event = parseInvoiceSubmittedEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoiceSubmitted');
    expect(event!.invoiceId).toBe(INVOICE_ID);
    expect(event!.issuer).toBe(TEST_ISSUER);
    expect(event!.amount).toBe(AMOUNT);
    expect(event!.timestamp).toBe(TIMESTAMP);
  });

  it('returns null for wrong event name', () => {
    const raw = makeRawEvent(
      [sym('invoice_funded'), u64(INVOICE_ID)],
      valueWith({ amount: i128(AMOUNT) })
    );
    expect(parseInvoiceSubmittedEvent(raw)).toBeNull();
  });

  it('returns null for missing topics', () => {
    const raw = makeRawEvent([], valueWith({}));
    expect(parseInvoiceSubmittedEvent(raw)).toBeNull();
  });
});

describe('parseInvoiceFundedEvent', () => {
  it('parses a valid InvoiceFunded event', () => {
    const raw = makeRawEvent(
      [sym('invoice_funded'), u64(INVOICE_ID), addressScVal(TEST_FUNDER)],
      valueWith({ amount: i128(AMOUNT) })
    );

    const event = parseInvoiceFundedEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoiceFunded');
    expect(event!.invoiceId).toBe(INVOICE_ID);
    expect(event!.funder).toBe(TEST_FUNDER);
    expect(event!.amount).toBe(AMOUNT);
    expect(event!.timestamp).toBe(TIMESTAMP);
  });

  it('returns null for wrong event name', () => {
    const raw = makeRawEvent(
      [sym('invoice_paid'), u64(INVOICE_ID)],
      valueWith({ amount: i128(AMOUNT) })
    );
    expect(parseInvoiceFundedEvent(raw)).toBeNull();
  });
});

describe('parseInvoicePaidEvent', () => {
  it('parses a valid InvoicePaid event', () => {
    const raw = makeRawEvent(
      [sym('invoice_paid'), u64(INVOICE_ID), addressScVal(TEST_PAYER)],
      valueWith({ amount: i128(AMOUNT) })
    );

    const event = parseInvoicePaidEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoicePaid');
    expect(event!.invoiceId).toBe(INVOICE_ID);
    expect(event!.payer).toBe(TEST_PAYER);
    expect(event!.amount).toBe(AMOUNT);
    expect(event!.timestamp).toBe(TIMESTAMP);
  });
});

describe('parseInvoiceCancelledEvent', () => {
  it('parses a valid InvoiceCancelled event', () => {
    const raw = makeRawEvent([sym('invoice_cancelled'), u64(INVOICE_ID)], valueWith({}));

    const event = parseInvoiceCancelledEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoiceCancelled');
    expect(event!.invoiceId).toBe(INVOICE_ID);
    expect(event!.timestamp).toBe(TIMESTAMP);
  });
});

describe('parseInvoiceExpiredEvent', () => {
  it('parses a valid InvoiceExpired event', () => {
    const raw = makeRawEvent([sym('invoice_expired'), u64(INVOICE_ID)], valueWith({}));

    const event = parseInvoiceExpiredEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoiceExpired');
    expect(event!.invoiceId).toBe(INVOICE_ID);
    expect(event!.timestamp).toBe(TIMESTAMP);
  });
});

describe('parseInvoiceDisputedEvent', () => {
  it('parses a valid InvoiceDisputed event', () => {
    const raw = makeRawEvent(
      [sym('invoice_disputed'), u64(INVOICE_ID), addressScVal(TEST_DISPUTER)],
      valueWith({})
    );

    const event = parseInvoiceDisputedEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoiceDisputed');
    expect(event!.invoiceId).toBe(INVOICE_ID);
    expect(event!.disputer).toBe(TEST_DISPUTER);
    expect(event!.timestamp).toBe(TIMESTAMP);
  });
});

describe('parseReputationUpdatedEvent', () => {
  it('parses a valid ReputationUpdated event', () => {
    const raw = makeRawEvent(
      [sym('reputation_updated'), addressScVal(TEST_ADDRESS)],
      valueWith({ score: u32(SCORE) })
    );

    const event = parseReputationUpdatedEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('ReputationUpdated');
    expect(event!.address).toBe(TEST_ADDRESS);
    expect(event!.score).toBe(SCORE);
    expect(event!.timestamp).toBe(TIMESTAMP);
  });
});

describe('parseContractPausedEvent', () => {
  it('parses a valid ContractPaused event', () => {
    const raw = makeRawEvent([sym('contract_paused')], valueWith({}));

    const event = parseContractPausedEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('ContractPaused');
    expect(event!.timestamp).toBe(TIMESTAMP);
  });
});

describe('parseTokenAddedEvent', () => {
  it('parses a valid TokenAdded event', () => {
    const raw = makeRawEvent([sym('token_added'), addressScVal(TEST_TOKEN)], valueWith({}));

    const event = parseTokenAddedEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('TokenAdded');
    expect(event!.token).toBe(TEST_TOKEN);
    expect(event!.timestamp).toBe(TIMESTAMP);
  });
});

describe('parseLPPositionTransferredEvent', () => {
  it('parses a valid LPPositionTransferred event', () => {
    const raw = makeRawEvent(
      [
        sym('lp_position_transferred'),
        addressScVal(TEST_FROM),
        addressScVal(TEST_TO),
        u64(INVOICE_ID),
      ],
      valueWith({})
    );

    const event = parseLPPositionTransferredEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('LPPositionTransferred');
    expect(event!.from).toBe(TEST_FROM);
    expect(event!.to).toBe(TEST_TO);
    expect(event!.invoiceId).toBe(INVOICE_ID);
    expect(event!.timestamp).toBe(TIMESTAMP);
  });

  it('returns null when topics are missing', () => {
    const raw = makeRawEvent([sym('lp_position_transferred')], valueWith({}));

    expect(parseLPPositionTransferredEvent(raw)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseContractEvent (unified dispatcher)
// ---------------------------------------------------------------------------

describe('parseContractEvent', () => {
  it('dispatches InvoiceSubmitted', () => {
    const raw = makeRawEvent(
      [sym('invoice_submitted'), u64(INVOICE_ID), addressScVal(TEST_ISSUER)],
      valueWith({ amount: i128(AMOUNT) })
    );
    const event = parseContractEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoiceSubmitted');
  });

  it('dispatches InvoiceFunded', () => {
    const raw = makeRawEvent(
      [sym('invoice_funded'), u64(INVOICE_ID), addressScVal(TEST_FUNDER)],
      valueWith({ amount: i128(AMOUNT) })
    );
    const event = parseContractEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoiceFunded');
  });

  it('dispatches InvoicePaid', () => {
    const raw = makeRawEvent(
      [sym('invoice_paid'), u64(INVOICE_ID), addressScVal(TEST_PAYER)],
      valueWith({ amount: i128(AMOUNT) })
    );
    const event = parseContractEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoicePaid');
  });

  it('dispatches InvoiceCancelled', () => {
    const raw = makeRawEvent([sym('invoice_cancelled'), u64(INVOICE_ID)], valueWith({}));
    const event = parseContractEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoiceCancelled');
  });

  it('dispatches InvoiceExpired', () => {
    const raw = makeRawEvent([sym('invoice_expired'), u64(INVOICE_ID)], valueWith({}));
    const event = parseContractEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoiceExpired');
  });

  it('dispatches InvoiceDisputed', () => {
    const raw = makeRawEvent(
      [sym('invoice_disputed'), u64(INVOICE_ID), addressScVal(TEST_DISPUTER)],
      valueWith({})
    );
    const event = parseContractEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('InvoiceDisputed');
  });

  it('dispatches ReputationUpdated', () => {
    const raw = makeRawEvent(
      [sym('reputation_updated'), addressScVal(TEST_ADDRESS)],
      valueWith({ score: u32(SCORE) })
    );
    const event = parseContractEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('ReputationUpdated');
  });

  it('dispatches ContractPaused', () => {
    const raw = makeRawEvent([sym('contract_paused')], valueWith({}));
    const event = parseContractEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('ContractPaused');
  });

  it('dispatches TokenAdded', () => {
    const raw = makeRawEvent([sym('token_added'), addressScVal(TEST_TOKEN)], valueWith({}));
    const event = parseContractEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('TokenAdded');
  });

  it('dispatches LPPositionTransferred', () => {
    const raw = makeRawEvent(
      [
        sym('lp_position_transferred'),
        addressScVal(TEST_FROM),
        addressScVal(TEST_TO),
        u64(INVOICE_ID),
      ],
      valueWith({})
    );
    const event = parseContractEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('LPPositionTransferred');
  });

  it('returns null for unknown event names', () => {
    const raw = makeRawEvent([sym('unknown_event'), u64(INVOICE_ID)], valueWith({}));
    expect(parseContractEvent(raw)).toBeNull();
  });

  it('returns null for empty topics', () => {
    const raw = makeRawEvent([], valueWith({}));
    expect(parseContractEvent(raw)).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(parseContractEvent(null as unknown as RawEvent)).toBeNull();
    expect(parseContractEvent(undefined as unknown as RawEvent)).toBeNull();
  });
});

describe('supportedEventTypes', () => {
  it('returns all 10 event type names', () => {
    const types = supportedEventTypes();
    expect(types).toHaveLength(10);
    expect(types).toContain('InvoiceSubmitted');
    expect(types).toContain('InvoiceFunded');
    expect(types).toContain('InvoicePaid');
    expect(types).toContain('InvoiceCancelled');
    expect(types).toContain('InvoiceExpired');
    expect(types).toContain('InvoiceDisputed');
    expect(types).toContain('ReputationUpdated');
    expect(types).toContain('ContractPaused');
    expect(types).toContain('TokenAdded');
    expect(types).toContain('LPPositionTransferred');
  });
});
