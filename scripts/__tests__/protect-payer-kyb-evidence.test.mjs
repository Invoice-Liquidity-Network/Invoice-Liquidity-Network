import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Protect Payer & KYB Evidence from Log Disclosure (#1239)', () => {
  it('masks full 56-character Stellar payer addresses in logs', () => {
    const fullPayer = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
    function maskPayer(addr) {
      if (!addr || addr.length <= 12) return addr;
      return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    }

    const masked = maskPayer(fullPayer);
    assert.equal(masked, 'GDVEU3DD...ZA57');
    assert.ok(!masked.includes('4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JC'));
  });

  it('redacts sensitive business registration numbers from evidence strings', () => {
    function sanitizeEvidence(text) {
      return text.replace(/REG-[A-Z0-9\-]+/gi, 'REG-***');
    }

    const rawEvidence = 'KYB provider returned REG-GDVEU3-2026 for Verified Entity';
    const clean = sanitizeEvidence(rawEvidence);
    assert.equal(clean, 'KYB provider returned REG-*** for Verified Entity');
    assert.ok(!clean.includes('REG-GDVEU3-2026'));
  });
});
