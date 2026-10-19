import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateIndependentSignOffWorkflow } from '../operations/verify-independent-signoff-workflow.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Independent Reviewer Sign-Off Workflow Suite (#1297)', () => {
  it('passes validation when distinct independent reviewers sign off on separated roles', () => {
    const tempFile = join(__dirname, 'mock-valid-multi-signoff.md');
    const mockContent = `
## Maintainer Sign-off

| Role | Maintainer | Signature | Date |
| --- | --- | --- | --- |
| Protocol lead | @core-dev | Confirmed | August 30, 2026 |
| Security lead | @sec-auditor | Confirmed | August 30, 2026 |
| Release lead | @ops-commander | Confirmed | August 30, 2026 |
`;
    writeFileSync(tempFile, mockContent, 'utf-8');

    try {
      const res = validateIndependentSignOffWorkflow(tempFile);
      assert.equal(res.valid, true);
      assert.equal(res.issuesCount, 0);
      assert.equal(res.distinctMaintainersCount, 3);
      assert.ok(res.sha256.length === 64);
    } finally {
      unlinkSync(tempFile);
    }
  });

  it('fails closed when a single maintainer consolidates protocol and security sign-offs', () => {
    const tempFile = join(__dirname, 'mock-single-signoff-collusion.md');
    const mockContent = `
## Maintainer Sign-off

| Role | Maintainer | Signature | Date |
| --- | --- | --- | --- |
| Protocol lead | @solo-maintainer | Confirmed | August 30, 2026 |
| Security lead | @solo-maintainer | Confirmed | August 30, 2026 |
`;
    writeFileSync(tempFile, mockContent, 'utf-8');

    try {
      const res = validateIndependentSignOffWorkflow(tempFile);
      assert.equal(res.valid, false);
      assert.ok(res.issues.some((iss) => iss.code === 'SEPARATION_OF_DUTIES_VIOLATION'));
      assert.ok(res.issues.some((iss) => iss.code === 'INSUFFICIENT_DISTINCT_SIGNERS'));
    } finally {
      unlinkSync(tempFile);
    }
  });

  it('fails closed when signature is unconfirmed', () => {
    const tempFile = join(__dirname, 'mock-unconfirmed-signoff.md');
    const mockContent = `
## Maintainer Sign-off

| Role | Maintainer | Signature | Date |
| --- | --- | --- | --- |
| Protocol lead | @core-dev | Confirmed | August 30, 2026 |
| Security lead | @sec-auditor | Pending | August 30, 2026 |
`;
    writeFileSync(tempFile, mockContent, 'utf-8');

    try {
      const res = validateIndependentSignOffWorkflow(tempFile);
      assert.equal(res.valid, false);
      assert.ok(res.issues.some((iss) => iss.code === 'UNCONFIRMED_SIGNATURE'));
    } finally {
      unlinkSync(tempFile);
    }
  });
});
