import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMainnetEvidenceGate } from '../operations/mainnet-evidence-gate.mjs';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Mainnet Evidence Gate Suite (#1293)', () => {
  it('passes and issues signed readiness certificate when all artifacts exist on disk', () => {
    const mockRegistry = [
      {
        item: 'Security Policy',
        category: 'Security',
        owner: 'Security lead',
        reproducibleCommand: 'verify:security-policy',
        expectedArtifact: 'SECURITY.md',
      },
      {
        item: 'Contributing Guide',
        category: 'Documentation',
        owner: 'Docs lead',
        reproducibleCommand: 'verify:checklist-evidence',
        expectedArtifact: 'CONTRIBUTING.md',
      },
    ];

    const res = evaluateMainnetEvidenceGate({ registry: mockRegistry });
    assert.equal(res.ready, true);
    assert.equal(res.failingCount, 0);
    assert.equal(res.verifiedCount, 2);
    assert.equal(res.certificate.gateStatus, 'PASSED');
    assert.ok(res.certificate.sha256.length === 64);
  });

  it('fails closed when an expected artifact is missing on disk regardless of text Done assertion', () => {
    const mockRegistryWithMissing = [
      {
        item: 'Audit Report',
        category: 'Security',
        owner: 'Security lead',
        reproducibleCommand: 'test:audit',
        expectedArtifact: '.artifacts/audits/non-existent-report.json',
      },
    ];

    const res = evaluateMainnetEvidenceGate({ registry: mockRegistryWithMissing });
    assert.equal(res.ready, false);
    assert.equal(res.failingCount, 1);
    assert.equal(res.certificate.gateStatus, 'BLOCKED');
    assert.equal(res.certificate.failingEvidence[0].reason, 'ARTIFACT_MISSING_ON_DISK');
  });

  it('fails closed when an artifact is empty (0 bytes)', () => {
    const tempEmpty = join(__dirname, 'empty-artifact.json');
    writeFileSync(tempEmpty, '   ', 'utf-8');

    const mockRegistryEmpty = [
      {
        item: 'Empty Trace',
        category: 'Infra',
        owner: 'Infra lead',
        reproducibleCommand: 'test:trace',
        expectedArtifact: 'scripts/__tests__/empty-artifact.json',
      },
    ];

    try {
      const res = evaluateMainnetEvidenceGate({ registry: mockRegistryEmpty });
      assert.equal(res.ready, false);
      assert.equal(res.failingCount, 1);
      assert.equal(res.certificate.failingEvidence[0].reason, 'ARTIFACT_EMPTY');
    } finally {
      unlinkSync(tempEmpty);
    }
  });
});
