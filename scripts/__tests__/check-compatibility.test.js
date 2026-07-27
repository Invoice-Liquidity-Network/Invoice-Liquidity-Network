import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  readContractVersion,
  readJsonVersion,
  parseCompatibilityMatrix,
  validateCompatibility
} from '../check-compatibility.ts';

describe('check-compatibility script', () => {
  const testTmpDir = join(tmpdir(), 'iln-compat-test-' + Date.now());

  // Helper to setup fixture directory structure
  function createFixtureTree({ contractVersion, sdkVersion, frontendVersion, matrixContent }) {
    const contractDir = join(testTmpDir, 'backend', 'contracts', 'invoice_liquidity');
    const sdkDir = join(testTmpDir, 'sdk');
    const frontendDir = join(testTmpDir, 'frontend');
    const docsDir = join(testTmpDir, 'docs');

    mkdirSync(contractDir, { recursive: true });
    mkdirSync(sdkDir, { recursive: true });
    mkdirSync(frontendDir, { recursive: true });
    mkdirSync(docsDir, { recursive: true });

    if (contractVersion !== undefined) {
      const cargoToml = `[package]\nname = "invoice_liquidity"\nversion = "${contractVersion}"\n`;
      writeFileSync(join(contractDir, 'Cargo.toml'), cargoToml, 'utf-8');
    }

    if (sdkVersion !== undefined) {
      const sdkPkg = JSON.stringify({ name: '@invoice-liquidity/sdk', version: sdkVersion });
      writeFileSync(join(sdkDir, 'package.json'), sdkPkg, 'utf-8');
    }

    if (frontendVersion !== undefined) {
      const fePkg = JSON.stringify({ name: 'ILN-Frontend', version: frontendVersion });
      writeFileSync(join(frontendDir, 'package.json'), fePkg, 'utf-8');
    }

    if (matrixContent !== undefined) {
      writeFileSync(join(docsDir, 'cross-repo-dependencies.md'), matrixContent, 'utf-8');
    }
  }

  test('readContractVersion extracts version from Cargo.toml fixture', () => {
    createFixtureTree({ contractVersion: '1.2.3' });
    const version = readContractVersion(testTmpDir);
    assert.equal(version, '1.2.3');
    rmSync(testTmpDir, { recursive: true, force: true });
  });

  test('readContractVersion throws error if version field is missing', () => {
    const contractDir = join(testTmpDir, 'backend', 'contracts', 'invoice_liquidity');
    mkdirSync(contractDir, { recursive: true });
    writeFileSync(join(contractDir, 'Cargo.toml'), '[package]\nname = "invoice_liquidity"\n', 'utf-8');

    assert.throws(
      () => readContractVersion(testTmpDir),
      /Could not find version/
    );
    rmSync(testTmpDir, { recursive: true, force: true });
  });

  test('readJsonVersion extracts version from package.json fixture', () => {
    createFixtureTree({ sdkVersion: '2.0.1' });
    const version = readJsonVersion('sdk/package.json', testTmpDir);
    assert.equal(version, '2.0.1');
    rmSync(testTmpDir, { recursive: true, force: true });
  });

  test('readJsonVersion throws error if version field is absent', () => {
    const sdkDir = join(testTmpDir, 'sdk');
    mkdirSync(sdkDir, { recursive: true });
    writeFileSync(join(sdkDir, 'package.json'), JSON.stringify({ name: 'sdk' }), 'utf-8');

    assert.throws(
      () => readJsonVersion('sdk/package.json', testTmpDir),
      /No "version" field/
    );
    rmSync(testTmpDir, { recursive: true, force: true });
  });

  test('parseCompatibilityMatrix extracts matrix rows correctly', () => {
    const docPath = join(testTmpDir, 'docs', 'cross-repo-dependencies.md');
    mkdirSync(join(testTmpDir, 'docs'), { recursive: true });

    const matrixMarkdown = `
# Cross-Repo Dependencies

<!-- COMPATIBILITY_MATRIX_START -->
| Contract | SDK | Frontend | Notes |
|---|---|---|---|
| \`0.1.0\` | \`0.1.0\` | \`0.1.0\` | Initial release |
| \`0.2.0\` | \`0.2.0\` | \`0.2.0\` | Minor upgrade |
<!-- COMPATIBILITY_MATRIX_END -->
`;
    writeFileSync(docPath, matrixMarkdown, 'utf-8');

    const rows = parseCompatibilityMatrix(docPath);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { contract: '0.1.0', sdk: '0.1.0', frontend: '0.1.0' });
    assert.deepEqual(rows[1], { contract: '0.2.0', sdk: '0.2.0', frontend: '0.2.0' });

    rmSync(testTmpDir, { recursive: true, force: true });
  });

  test('parseCompatibilityMatrix throws when start/end markers are missing', () => {
    const docPath = join(testTmpDir, 'docs', 'cross-repo-dependencies.md');
    mkdirSync(join(testTmpDir, 'docs'), { recursive: true });
    writeFileSync(docPath, '# No markers here', 'utf-8');

    assert.throws(
      () => parseCompatibilityMatrix(docPath),
      /Could not find compatibility matrix markers/
    );

    rmSync(testTmpDir, { recursive: true, force: true });
  });

  test('validateCompatibility returns success for matching version matrix', () => {
    const sampleMatrix = `
<!-- COMPATIBILITY_MATRIX_START -->
| Contract | SDK | Frontend |
|---|---|---|
| \`1.0.0\` | \`1.0.0\` | \`1.0.0\` |
<!-- COMPATIBILITY_MATRIX_END -->
`;
    createFixtureTree({
      contractVersion: '1.0.0',
      sdkVersion: '1.0.0',
      frontendVersion: '1.0.0',
      matrixContent: sampleMatrix
    });

    const res = validateCompatibility(testTmpDir);
    assert.equal(res.success, true);
    assert.ok(res.message.includes('found in the compatibility matrix'));

    rmSync(testTmpDir, { recursive: true, force: true });
  });

  test('validateCompatibility returns failure when versions do not match matrix', () => {
    const sampleMatrix = `
<!-- COMPATIBILITY_MATRIX_START -->
| Contract | SDK | Frontend |
|---|---|---|
| \`1.0.0\` | \`1.0.0\` | \`1.0.0\` |
<!-- COMPATIBILITY_MATRIX_END -->
`;
    createFixtureTree({
      contractVersion: '2.0.0',
      sdkVersion: '1.0.0',
      frontendVersion: '1.0.0',
      matrixContent: sampleMatrix
    });

    const res = validateCompatibility(testTmpDir);
    assert.equal(res.success, false);
    assert.ok(res.message.includes('NOT found in the compatibility matrix'));

    rmSync(testTmpDir, { recursive: true, force: true });
  });
});
