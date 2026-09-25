import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import fc from 'fast-check';

/**
 * Generators for the indexer fuzz suite. They deliberately produce far more
 * than the RPC ever will: every field can be missing, the wrong type, an XDR
 * value of the wrong kind, or an out-of-range number. Valid shapes are mixed in
 * at a high enough weight that the idempotency and integrity properties get
 * exercised on real events, not only on garbage.
 */
export const KNOWN_TOPICS = ['submitted', 'funded', 'paid', 'defaulted'] as const;

/** Sentinel for "field absent"; converted to a real `undefined` by `materialize`. */
export const ABSENT = { $absent: true } as const;

const symbolText = fc.oneof(
  { arbitrary: fc.constantFrom(...KNOWN_TOPICS), weight: 6 },
  { arbitrary: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,15}$/), weight: 2 },
  { arbitrary: fc.string({ maxLength: 12 }), weight: 1 },
  { arbitrary: fc.constant(''), weight: 1 }
);

export const topicScVal: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: symbolText.map((s) => xdr.ScVal.scvSymbol(s)), weight: 8 },
  { arbitrary: fc.integer().map((n) => nativeToScVal(n)), weight: 1 },
  { arbitrary: fc.constant(xdr.ScVal.scvVoid()), weight: 1 },
  {
    arbitrary: fc.uint8Array({ maxLength: 8 }).map((b) => xdr.ScVal.scvBytes(Buffer.from(b))),
    weight: 1,
  },
  { arbitrary: fc.constant('not-a-scval'), weight: 1 },
  { arbitrary: fc.constant(null), weight: 1 },
  { arbitrary: fc.constant({ switch: 'nope' }), weight: 1 }
);

export const topicArb: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: fc.array(topicScVal, { minLength: 1, maxLength: 3 }), weight: 8 },
  { arbitrary: fc.constant([]), weight: 1 },
  { arbitrary: fc.constant(ABSENT), weight: 1 },
  { arbitrary: fc.constant(null), weight: 1 },
  { arbitrary: fc.constant('submitted'), weight: 1 }
);

export const valueArb: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: fc.bigUintN(53).map((n) => nativeToScVal(n, { type: 'u64' })), weight: 8 },
  { arbitrary: fc.bigUintN(64).map((n) => nativeToScVal(n, { type: 'u64' })), weight: 2 },
  { arbitrary: fc.bigIntN(64).map((n) => nativeToScVal(n, { type: 'i64' })), weight: 1 },
  { arbitrary: fc.bigIntN(100).map((n) => nativeToScVal(n, { type: 'i128' })), weight: 1 },
  { arbitrary: fc.string({ maxLength: 10 }).map((s) => nativeToScVal(s)), weight: 1 },
  { arbitrary: fc.constant(xdr.ScVal.scvVoid()), weight: 1 },
  { arbitrary: fc.boolean().map((b) => nativeToScVal(b)), weight: 1 },
  { arbitrary: fc.constant(nativeToScVal([1n, 2n], { type: 'u64' })), weight: 1 },
  { arbitrary: fc.constant(ABSENT), weight: 1 },
  { arbitrary: fc.constant({ garbage: true }), weight: 1 }
);

export const idArb: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: fc.stringMatching(/^[0-9]{10}-[0-9]-[0-9]$/), weight: 6 },
  { arbitrary: fc.string({ minLength: 1, maxLength: 20 }), weight: 3 },
  { arbitrary: fc.string({ minLength: 129, maxLength: 140 }), weight: 1 },
  { arbitrary: fc.constant(''), weight: 1 },
  { arbitrary: fc.constant(42), weight: 1 },
  { arbitrary: fc.constant(ABSENT), weight: 1 }
);

export const ledgerArb: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 2_147_483_647 }), weight: 8 },
  { arbitrary: fc.constant(-1), weight: 1 },
  { arbitrary: fc.constant(Number.NaN), weight: 1 },
  { arbitrary: fc.double({ noNaN: true, noInteger: true }), weight: 1 },
  { arbitrary: fc.constant(ABSENT), weight: 1 },
  { arbitrary: fc.constant('42'), weight: 1 }
);

export const closedAtArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    arbitrary: fc
      .date({ noInvalidDate: true, min: new Date(0), max: new Date('2100-01-01') })
      .map((d) => d.toISOString()),
    weight: 8,
  },
  { arbitrary: fc.string({ maxLength: 8 }), weight: 1 },
  { arbitrary: fc.constant(ABSENT), weight: 1 },
  { arbitrary: fc.constant(7), weight: 1 }
);

export interface RawEventShape {
  id: unknown;
  ledger: unknown;
  ledgerClosedAt: unknown;
  topic: unknown;
  value: unknown;
}

export const eventArb: fc.Arbitrary<RawEventShape> = fc.record({
  id: idArb,
  ledger: ledgerArb,
  ledgerClosedAt: closedAtArb,
  topic: topicArb,
  value: valueArb,
});

/** Converts ABSENT sentinels into genuinely missing properties and adds the constant RPC fields. */
export function materialize(shape: RawEventShape): Record<string, unknown> {
  const out: Record<string, unknown> = {
    pagingToken: 'p',
    type: 'contract',
    contractId: 'CTEST',
    inSuccessfulContractCall: true,
  };
  for (const [key, value] of Object.entries(shape)) {
    if (value === ABSENT) continue;
    out[key] = value;
  }
  return out;
}

/** What the mocked `fetchInvoice` returns for a run. */
export type InvoiceScript =
  | { kind: 'null' }
  | { kind: 'valid'; status: string }
  | { kind: 'malformed'; value: unknown }
  | { kind: 'throw' };

export const invoiceScriptArb: fc.Arbitrary<InvoiceScript> = fc.oneof(
  { arbitrary: fc.constant({ kind: 'null' } as InvoiceScript), weight: 2 },
  {
    arbitrary: fc
      .constantFrom('Pending', 'Funded', 'Paid', 'Defaulted')
      .map((status) => ({ kind: 'valid', status } as InvoiceScript)),
    weight: 6,
  },
  {
    arbitrary: fc
      .constantFrom({ id: 'x' }, {}, { id: 1, freelancer: '' }, 'string', 12)
      .map((value) => ({ kind: 'malformed', value } as InvoiceScript)),
    weight: 2,
  },
  { arbitrary: fc.constant({ kind: 'throw' } as InvoiceScript), weight: 1 }
);

export const FREELANCER = 'GBSOVFQ4MFEHKV37QXGFKRM66CKFWWU47CRXGAWTP7DQIRMUQK56OPR';
export const PAYER = 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';

export function validInvoice(id: number, status = 'Pending') {
  return {
    id,
    freelancer: FREELANCER,
    payer: PAYER,
    amount: '100000000',
    due_date: 9999999999,
    discount_rate: 300,
    status,
    funder: status === 'Funded' || status === 'Paid' ? PAYER : null,
    funded_at: status === 'Funded' || status === 'Paid' ? 1700000000 : null,
  };
}
