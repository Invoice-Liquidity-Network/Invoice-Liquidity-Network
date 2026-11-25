/**
 * Tests for Soroban ScVal XDR decoding and unknown-field handling (#1492).
 *
 * `scValToNative` falls through to returning the raw XDR value itself for a
 * handful of variants it doesn't convert (e.g. a contract instance or a
 * ledger-key nonce). Before this fix, the CLI's decoder silently serialized
 * that raw value's SDK-internal properties as if they were real decoded
 * fields — misrepresenting the value instead of flagging it as undecodable.
 */

import { describe, expect, it } from 'vitest';
import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';

import { decodeScValXdr, formatDecodedScVal } from '../src/xdr';

function toBase64(scv: xdr.ScVal): string {
  return scv.toXDR('base64');
}

describe('decodeScValXdr', () => {
  it('decodes primitive and compound values cleanly', () => {
    expect(decodeScValXdr(toBase64(nativeToScVal(42, { type: 'u32' })))).toBe(42);
    expect(decodeScValXdr(toBase64(nativeToScVal('hello', { type: 'string' })))).toBe('hello');
    expect(decodeScValXdr(toBase64(nativeToScVal(123n, { type: 'i128' })))).toBe('123');

    const address = Keypair.random().publicKey();
    expect(decodeScValXdr(toBase64(Address.fromString(address).toScVal()))).toBe(address);

    const vec = nativeToScVal([1, 2, 3], { type: 'u32' });
    expect(decodeScValXdr(toBase64(vec))).toEqual([1, 2, 3]);
  });

  it('decodes a map into a plain readable object', () => {
    const map = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: nativeToScVal('amount', { type: 'symbol' }),
        val: nativeToScVal(100, { type: 'u32' }),
      }),
    ]);
    expect(decodeScValXdr(toBase64(map))).toEqual({ amount: 100 });
  });

  it('rejects empty input', () => {
    expect(() => decodeScValXdr('   ')).toThrow(/non-empty base64/);
  });

  it('rejects malformed base64 as invalid XDR', () => {
    expect(() => decodeScValXdr('not-valid-xdr')).toThrow(/Invalid ScVal XDR/);
  });

  it('refuses to silently serialize a contract instance it cannot fully decode', () => {
    const contractInstance = new xdr.ScContractInstance({
      executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 7)),
      storage: null,
    });
    const scv = xdr.ScVal.scvContractInstance(contractInstance);

    expect(() => decodeScValXdr(toBase64(scv))).toThrow(/unsupported SCVal variant/);
  });

  it('refuses to silently serialize a ledger-key nonce it cannot fully decode', () => {
    const nonceKey = new xdr.ScNonceKey({ nonce: xdr.Int64.fromString('42') });
    const scv = xdr.ScVal.scvLedgerKeyNonce(nonceKey);

    expect(() => decodeScValXdr(toBase64(scv))).toThrow(/unsupported SCVal variant/);
  });
});

describe('formatDecodedScVal', () => {
  it('pretty-prints decoded values as JSON with a trailing newline', () => {
    expect(formatDecodedScVal({ amount: 100 })).toBe('{\n  "amount": 100\n}\n');
  });
});
