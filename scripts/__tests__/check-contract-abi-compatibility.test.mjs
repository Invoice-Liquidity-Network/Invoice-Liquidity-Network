import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFunctionInputCounts,
  checkCompatibility,
  CONTRACT_CALL_MANIFEST,
} from '../check-contract-abi-compatibility.mjs';

function specJsonWith(functions) {
  return JSON.stringify([
    { type: 'UdtStructV0', name: 'invoice', fields: [] },
    ...functions.map(({ name, inputCount }) => ({
      type: 'FunctionV0',
      name,
      inputs: Array.from({ length: inputCount }, (_, i) => ({ name: `arg${i}`, type: { type: 'U32' } })),
    })),
  ]);
}

describe('parseFunctionInputCounts', () => {
  it('extracts only FunctionV0 entries, ignoring UDT entries', () => {
    const json = specJsonWith([{ name: 'submit_invoice', inputCount: 6 }]);
    const counts = parseFunctionInputCounts(json);
    assert.equal(counts.size, 1);
    assert.equal(counts.get('submit_invoice'), 6);
  });

  it('treats an entry with no inputs array as 0 inputs', () => {
    const json = JSON.stringify([{ type: 'FunctionV0', name: 'get_contract_stats' }]);
    const counts = parseFunctionInputCounts(json);
    assert.equal(counts.get('get_contract_stats'), 0);
  });
});

describe('checkCompatibility', () => {
  it('reports no findings when the full real manifest matches its expected arity exactly', () => {
    const functions = CONTRACT_CALL_MANIFEST.map((c) => ({
      name: c.method,
      inputCount: c.required,
    }));
    const counts = parseFunctionInputCounts(specJsonWith(functions));
    const findings = checkCompatibility(counts, CONTRACT_CALL_MANIFEST);
    assert.deepEqual(findings, []);
  });

  it('accepts a spec input count anywhere within [required, required+optional]', () => {
    const counts = parseFunctionInputCounts(specJsonWith([{ name: 'fund_invoice', inputCount: 4 }]));
    const manifest = [{ method: 'fund_invoice', required: 3, optional: 1, caller: 'x' }];
    assert.deepEqual(checkCompatibility(counts, manifest), []);
  });

  it('flags a method that no longer exists in the deployed ABI', () => {
    const counts = parseFunctionInputCounts(specJsonWith([{ name: 'unrelated_fn', inputCount: 1 }]));
    const manifest = [{ method: 'submit_invoice', required: 6, optional: 2, caller: 'InvoiceClient.submitInvoice' }];
    const findings = checkCompatibility(counts, manifest);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'MISSING_IN_SPEC');
  });

  it('flags a new required contract argument the SDK does not send (arity too high)', () => {
    // Simulates the exact scenario from the issue: a contract change deployed
    // without a corresponding SDK update.
    const counts = parseFunctionInputCounts(specJsonWith([{ name: 'submit_invoice', inputCount: 9 }]));
    const manifest = [{ method: 'submit_invoice', required: 6, optional: 2, caller: 'InvoiceClient.submitInvoice' }];
    const findings = checkCompatibility(counts, manifest);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'ARITY_MISMATCH');
    assert.equal(findings[0].specInputs, 9);
  });

  it('flags a removed contract argument the SDK still sends (arity too low)', () => {
    const counts = parseFunctionInputCounts(specJsonWith([{ name: 'mark_paid', inputCount: 2 }]));
    const manifest = [{ method: 'mark_paid', required: 3, optional: 0, caller: 'InvoiceClient.markPaid' }];
    const findings = checkCompatibility(counts, manifest);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'ARITY_MISMATCH');
  });
});
