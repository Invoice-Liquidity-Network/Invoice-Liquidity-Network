import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLiquidityDisclosures,
  REQUIRED_DISCLOSURE_SECTIONS,
  REQUIRED_DISCLOSURE_TERMS,
} from '../operations/check-liquidity-disclosures.mjs';

describe('Investor Liquidity Disclosures Suite (#1314)', () => {
  it('validates canonical liquidity disclosures document successfully', () => {
    const res = validateLiquidityDisclosures();
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
    assert.equal(res.sectionsVerified, REQUIRED_DISCLOSURE_SECTIONS.length);
    assert.equal(res.termsVerified, REQUIRED_DISCLOSURE_TERMS.length);
    assert.ok(res.sha256.length === 64);
  });

  it('fails closed when disclosures document does not exist', () => {
    assert.throws(
      () => validateLiquidityDisclosures('/non/existent/path/disclosures.md'),
      /Liquidity disclosures document not found/
    );
  });
});
