import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { createDb, setDb } from '../src/db';
import {
  countDeadLetters,
  deadLetterEvent,
  listDeadLetters,
  serializeEventPayload,
} from '../src/deadLetter';
import { decodeEvent, isValidInvoiceState, toInvoiceId } from '../src/decode';

const base = () => ({
  id: '0000001234-0-0',
  ledger: 1000,
  ledgerClosedAt: '2024-01-01T00:00:00Z',
  topic: [xdr.ScVal.scvSymbol('submitted')],
  value: nativeToScVal(7n, { type: 'u64' }),
});

describe('decodeEvent', () => {
  it('decodes a well-formed event', () => {
    expect(decodeEvent(base(), 5)).toEqual({
      kind: 'ok',
      event: {
        event_id: '0000001234-0-0',
        event_type: 'submitted',
        invoice_id: 7,
        ledger: 1000,
        ledger_closed_at: '2024-01-01T00:00:00Z',
        created_at: 5,
      },
    });
  });

  it('ignores empty and unknown topics', () => {
    expect(decodeEvent({ ...base(), topic: [] })).toEqual({
      kind: 'ignored',
      reason: 'empty_topic',
    });
    expect(decodeEvent({ ...base(), topic: undefined })).toEqual({
      kind: 'ignored',
      reason: 'empty_topic',
    });
    expect(decodeEvent({ ...base(), topic: [xdr.ScVal.scvSymbol('renamed')] })).toEqual({
      kind: 'ignored',
      reason: 'unknown_topic',
    });
  });

  it.each([
    ['not an object', null, 'not_an_object'],
    ['numeric id', { ...base(), id: 42 }, 'event_id_invalid'],
    ['empty id', { ...base(), id: '' }, 'event_id_invalid'],
    ['overlong id', { ...base(), id: 'x'.repeat(129) }, 'event_id_invalid'],
    ['float ledger', { ...base(), ledger: 1.5 }, 'ledger_invalid'],
    ['negative ledger', { ...base(), ledger: -1 }, 'ledger_invalid'],
    ['string ledger', { ...base(), ledger: '42' }, 'ledger_invalid'],
    ['numeric closed-at', { ...base(), ledgerClosedAt: 7 }, 'ledger_closed_at_invalid'],
    ['topic not array', { ...base(), topic: 'submitted' }, 'topic_not_array'],
    ['null topic entry', { ...base(), topic: [null] }, 'topic_not_scval'],
    ['string topic entry', { ...base(), topic: ['submitted'] }, 'topic_not_scval'],
    [
      'bytes topic',
      { ...base(), topic: [xdr.ScVal.scvBytes(Buffer.from([1]))] },
      'topic_not_symbol',
    ],
    ['missing value', { ...base(), value: undefined }, 'value_not_scval'],
    ['garbage value', { ...base(), value: { garbage: true } }, 'value_not_scval'],
    ['string value', { ...base(), value: nativeToScVal('x') }, 'invoice_id_invalid'],
    [
      'negative value',
      { ...base(), value: nativeToScVal(-1n, { type: 'i128' }) },
      'invoice_id_invalid',
    ],
    [
      'value above 2^53',
      { ...base(), value: nativeToScVal(2n ** 60n, { type: 'u64' }) },
      'invoice_id_invalid',
    ],
    [
      'vector value',
      { ...base(), value: nativeToScVal([1n], { type: 'u64' }) },
      'invoice_id_invalid',
    ],
  ])('rejects %s', (_label, input, reason) => {
    expect(decodeEvent(input)).toMatchObject({ kind: 'malformed', reason });
  });

  it('bounds invoice ids to safe non-negative integers', () => {
    expect(toInvoiceId(7n)).toBe(7);
    expect(toInvoiceId(7)).toBe(7);
    expect(toInvoiceId(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(toInvoiceId(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBeNull();
    expect(toInvoiceId(-1n)).toBeNull();
    expect(toInvoiceId(1.5)).toBeNull();
    expect(toInvoiceId('7')).toBeNull();
  });
});

describe('isValidInvoiceState', () => {
  const valid = {
    id: 1,
    freelancer: 'G1',
    payer: 'G2',
    amount: '100',
    due_date: 1,
    discount_rate: 300,
    status: 'Pending',
    funder: null,
    funded_at: null,
  };
  it('accepts the shape fetchInvoice produces', () => {
    expect(isValidInvoiceState(valid)).toBe(true);
    expect(isValidInvoiceState({ ...valid, status: 'Funded', funder: 'G3', funded_at: 5 })).toBe(
      true
    );
  });
  it.each([
    [{ id: 'x' }],
    [{}],
    ['string'],
    [{ ...valid, amount: '1.5' }],
    [{ ...valid, status: 'Weird' }],
    [{ ...valid, funder: 7 }],
    [{ ...valid, freelancer: '' }],
  ])('rejects %j', (input) => {
    expect(isValidInvoiceState(input)).toBe(false);
  });
});

describe('dead-letter table', () => {
  it('stores a replayable payload with XDR values as base64 and a bounded reason', () => {
    setDb(createDb(':memory:'));
    const raw = { ...base(), topic: [null], extra: 5n, nested: { fn: () => 1 } };
    const id = deadLetterEvent(raw, 'topic_not_scval', 'detail');
    expect(id).toBe(1);
    expect(countDeadLetters()).toBe(1);
    const [row] = listDeadLetters();
    expect(row).toMatchObject({
      event_id: '0000001234-0-0',
      reason: 'topic_not_scval',
      detail: 'detail',
      ledger: 1000,
      replayed_at: null,
    });
    const payload = JSON.parse(row.payload);
    expect(payload.value).toEqual({ $xdr: nativeToScVal(7n, { type: 'u64' }).toXDR('base64') });
    expect(payload.extra).toEqual({ $bigint: '5' });
    expect(payload.nested.fn).toEqual({ $unserializable: 'function' });
  });

  it('serialises cycles, undefined and huge payloads without throwing', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(JSON.parse(serializeEventPayload(cyclic))).toEqual({ a: 1, self: { $cycle: true } });
    expect(JSON.parse(serializeEventPayload(undefined))).toEqual({ $undefined: true });
    const huge = serializeEventPayload({ blob: 'x'.repeat(200_000) });
    expect(JSON.parse(huge)).toMatchObject({ $truncated: true });
    expect(huge.length).toBeLessThan(70_000);
  });
});
