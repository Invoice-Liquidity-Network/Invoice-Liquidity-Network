import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuditEvidence } from '../operations/verify-audit-evidence.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('External Audit Evidence Suite (#1294)', () => {
  it('passes validation for canonical audit evidence manifest', () => {
    const res = verifyAuditEvidence();
    assert.equal(res.valid, true);
    assert.equal(res.violationsCount, 0);
    assert.equal(res.auditor, 'Stellar Ecosystem Security Consortium (SESC)');
    assert.ok(res.sha256.length === 64);
  });

  it('fails closed when an unresolved critical vulnerability is present', () => {
    const tempFile = join(__dirname, 'mock-unresolved-audit.json');
    const mockManifest = {
      auditor: 'Auditor Corp',
      leadAuditor: 'Lead',
      auditReportId: 'REP-01',
      completionDate: '2026-08-20T00:00:00.000Z',
      findings: [
        { id: 'VULN-1', severity: 'critical', status: 'OPEN', title: 'Reentrancy drain' }
      ],
      verdict: 'PASSED_FOR_MAINNET'
    };
    writeFileSync(tempFile, JSON.stringify(mockManifest), 'utf-8');

    try {
      const res = verifyAuditEvidence(tempFile);
      assert.equal(res.valid, false);
      assert.ok(res.violations.some((v) => v.rule === 'UNRESOLVED_CRITICAL_HIGH_FINDINGS'));
    } finally {
      unlinkSync(tempFile);
    }
  });

  it('fails closed when audit exceeds freshness threshold', () => {
    const tempFile = join(__dirname, 'mock-stale-audit.json');
    const mockManifest = {
      auditor: 'Auditor Corp',
      leadAuditor: 'Lead',
      auditReportId: 'REP-01',
      completionDate: '2025-01-01T00:00:00.000Z', // >180 days old
      findings: [],
      verdict: 'PASSED_FOR_MAINNET'
    };
    writeFileSync(tempFile, JSON.stringify(mockManifest), 'utf-8');

    try {
      const res = verifyAuditEvidence(tempFile, { referenceDate: '2026-08-30', maxAgeDays: 180 });
      assert.equal(res.valid, false);
      assert.ok(res.violations.some((v) => v.rule === 'STALE_AUDIT_EVIDENCE'));
    } finally {
      unlinkSync(tempFile);
    }
  });
});
