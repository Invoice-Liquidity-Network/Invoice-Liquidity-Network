import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAndVerifyLaunchArtifactLedger,
  LAUNCH_ROW_ARTIFACT_REGISTRY,
} from '../operations/launch-row-artifact-mapping.mjs';

describe('Launch Row Verification Artifacts Suite (#1296)', () => {
  it('maps all checklist rows to reproducible verification commands and artifacts', () => {
    const res = buildAndVerifyLaunchArtifactLedger();
    assert.equal(res.valid, true);
    assert.equal(res.missingFromRegistry.length, 0);
    assert.equal(res.totalMappedRows, LAUNCH_ROW_ARTIFACT_REGISTRY.length);
    assert.ok(res.sha256.length === 64);
  });
});
