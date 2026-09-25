import { nativeToScVal } from '@stellar/stellar-sdk';
import fc from 'fast-check';

import { xdr } from './xdr';

const TESTNET_INVOICE_RETVAL_XDR =
  'AAAAEQAAAAEAAAADAAAADgAAAAZhbW91bnQAAAAAAAUAAAAAO5rKAAAAAA4AAAACaWQAAAAAAAUAAAAAAAAAKgAAAA4AAAAGc3RhdHVzAAAAAAAOAAAABkZ1bmRlZAAA';
const TESTNET_EVENT_PAYLOAD_XDR =
  'AAAAEAAAAAEAAAADAAAADwAAAA5pbnZvaWNlX2Z1bmRlZAAAAAAABQAAAAAAAAAqAAAACgAAAAAAAAAAAAAAADuaygA=';

const scValArbitrary = fc.letrec((tie) => ({
  value: fc.oneof(
    { withCrossShrink: true, depthFactor: 0.5 },
    fc.boolean(),
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n }),
    fc.string({ maxLength: 32 }),
    fc.uint8Array({ maxLength: 32 }),
    fc.array(tie('value'), { maxLength: 8 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), tie('value'), { maxKeys: 8 })
  ),
})).value;

describe('xdr utilities', () => {
  it('encodes a ScVal to base64 XDR', () => {
    const value = nativeToScVal('invoice_submitted', { type: 'symbol' });

    expect(xdr.encode(value)).toBe('AAAADwAAABFpbnZvaWNlX3N1Ym1pdHRlZAAAAA==');
  });

  it('preserves arbitrary supported values through XDR encode/decode', () => {
    fc.assert(
      fc.property(scValArbitrary, (value) => {
        const scVal = nativeToScVal(value);
        const encoded = xdr.encode(scVal);
        expect(xdr.encode(xdr.decode(encoded))).toBe(encoded);
      }),
      { numRuns: 500 }
    );
  });

  it('decodes a testnet contract return fixture into a typed ScVal', () => {
    const scVal = xdr.decode(TESTNET_INVOICE_RETVAL_XDR);

    expect(xdr.encode(scVal)).toBe(TESTNET_INVOICE_RETVAL_XDR);
  });

  it('converts testnet ScVal fixtures to readable logging objects', () => {
    expect(xdr.toReadable(xdr.decode(TESTNET_INVOICE_RETVAL_XDR))).toEqual({
      amount: '1000000000',
      id: '42',
      status: 'Funded',
    });

    expect(xdr.toReadable(xdr.decode(TESTNET_EVENT_PAYLOAD_XDR))).toEqual([
      'invoice_funded',
      '42',
      '1000000000',
    ]);
  });

  it('rejects invalid base64 ScVal payloads', () => {
    expect(() => xdr.decode('not-xdr')).toThrow('Invalid ScVal XDR');
  });
});
