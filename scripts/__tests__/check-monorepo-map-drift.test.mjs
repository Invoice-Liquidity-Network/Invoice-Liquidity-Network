import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTables,
  extractPackageRows,
  normalizeStatus,
  buildFindings,
} from '../check-monorepo-map-drift.mjs';

const SAMPLE_DOC = `# Monorepo Map

## Top-Level Service Packages

| Path | Package | Status | Purpose | Dependencies |
|------|---------|--------|---------|-------------|
| \`sdk/\` | \`@iln/sdk\` | Stable | The SDK. | — |
| \`cli/\` | \`@invoice-liquidity/cli\` | Stable | The CLI. | \`@iln/sdk\` |

## Shared Library Packages (packages/*)

| Path | Package | Status | Purpose | Dependencies |
|------|---------|--------|---------|-------------|
| \`packages/shared/\` | \`@iln/shared\` | Stable | Shared types. | — |
| \`packages/opentelemetry/\` | \`@iln/opentelemetry\` | Experimental | OTel. | \`@iln/sdk\` |
`;

describe('parseTables', () => {
  it('parses header and data rows, skipping separators', () => {
    const tables = parseTables(SAMPLE_DOC);
    const pkgTables = tables.filter((t) => t.headers.some((h) => /path/i.test(h)));
    assert.equal(pkgTables.length, 2);
    assert.deepEqual(pkgTables[0].headers, ['Path', 'Package', 'Status', 'Purpose', 'Dependencies']);
    assert.equal(pkgTables[0].rows.length, 2);
    assert.deepEqual(pkgTables[0].rows[0], ['`sdk/`', '`@iln/sdk`', 'Stable', 'The SDK.', '—']);
  });

  it('handles escaped pipes inside cells', () => {
    const md = '| A | B |\n|---|---|\n| x\\|y | z |\n';
    const tables = parseTables(md);
    assert.deepEqual(tables[0].rows[0], ['x|y', 'z']);
  });
});

describe('normalizeStatus', () => {
  it('extracts canonical keyword from decorated status text', () => {
    assert.equal(normalizeStatus('Stable (content source of record)'), 'Stable');
    assert.equal(normalizeStatus('Next (partial content migration)'), 'Next');
    assert.equal(normalizeStatus('Experimental'), 'Experimental');
    assert.equal(normalizeStatus('Deprecated'), 'Deprecated');
  });

  it('returns null when no status keyword is present', () => {
    assert.equal(normalizeStatus('—'), null);
    assert.equal(normalizeStatus(''), null);
  });
});

describe('extractPackageRows', () => {
  it('collects path, package, and status from tables with Path+Status columns', () => {
    const rows = extractPackageRows(parseTables(SAMPLE_DOC));
    assert.equal(rows.length, 4);
    const cli = rows.find((r) => r.path === 'cli/');
    assert.equal(cli.pkg, '@invoice-liquidity/cli');
    assert.equal(cli.status, 'Stable');
  });
});

describe('buildFindings', () => {
  function makePackages() {
    return new Map([
      ['sdk/', { name: '@iln/sdk', version: '1.0.0', private: false }],
      ['cli/', { name: '@invoice-liquidity/cli', version: '1.0.0', private: false }],
      ['packages/shared/', { name: '@iln/shared', version: '1.0.0', private: false }],
      ['packages/opentelemetry/', { name: '@iln/opentelemetry', version: '0.1.0', private: false }],
    ]);
  }

  it('reports no findings when doc and package.json agree', () => {
    const rows = extractPackageRows(parseTables(SAMPLE_DOC));
    const findings = buildFindings(rows, makePackages());
    assert.equal(findings.length, 0);
  });

  it('flags a deprecated package missing from the doc', () => {
    const doc = SAMPLE_DOC.replace('| Stable | The SDK.', '| Next | The SDK.');
    const rows = extractPackageRows(parseTables(doc));
    const packages = makePackages();
    packages.set('sdk/', { name: '@iln/sdk', version: '1.0.0', private: false, deprecated: 'use v2' });
    const findings = buildFindings(rows, packages);
    const hit = findings.find((f) => f.code === 'DEPRECATED_NOT_IN_DOC');
    assert.ok(hit, 'expected DEPRECATED_NOT_IN_DOC');
  });

  it('flags a doc-only Deprecated status with no package.json notice', () => {
    const doc = SAMPLE_DOC.replace('| Experimental | OTel.', '| Deprecated | OTel.');
    const rows = extractPackageRows(parseTables(doc));
    const findings = buildFindings(rows, makePackages());
    const hit = findings.find((f) => f.code === 'DEPRECATED_DOC_ONLY');
    assert.ok(hit, 'expected DEPRECATED_DOC_ONLY');
  });

  it('flags a public publish intent contradicted by private: true', () => {
    const packages = makePackages();
    packages.set('cli/', {
      name: '@invoice-liquidity/cli',
      version: '1.0.0',
      private: true,
      publishConfig: { access: 'public' },
    });
    const rows = extractPackageRows(parseTables(SAMPLE_DOC));
    const findings = buildFindings(rows, packages);
    const hit = findings.find((f) => f.code === 'PUBLISH_INTENT_PRIVATE');
    assert.ok(hit, 'expected PUBLISH_INTENT_PRIVATE');
  });

  it('does not flag ordinary private internal packages marked Stable', () => {
    const packages = makePackages();
    packages.set('cli/', { name: '@invoice-liquidity/cli', version: '1.0.0', private: true });
    const rows = extractPackageRows(parseTables(SAMPLE_DOC));
    const findings = buildFindings(rows, packages);
    assert.equal(findings.filter((f) => f.code === 'PUBLISH_INTENT_PRIVATE').length, 0);
  });

  it('flags a documented name that disagrees with package.json', () => {
    const packages = makePackages();
    packages.set('cli/', { name: '@iln/cli', version: '1.0.0', private: false });
    const rows = extractPackageRows(parseTables(SAMPLE_DOC));
    const findings = buildFindings(rows, packages);
    const hit = findings.find((f) => f.code === 'NAME_MISMATCH');
    assert.ok(hit, 'expected NAME_MISMATCH');
  });

  it('flags a stale doc row whose path does not exist', () => {
    const doc =
      '| Path | Package | Status |\n|---|---|---|\n| `packages/ghost/` | `@iln/ghost` | Next |\n';
    const rows = extractPackageRows(parseTables(doc));
    const findings = buildFindings(rows, new Map());
    const hit = findings.find((f) => f.code === 'STALE_DOC_ROW');
    assert.ok(hit, 'expected STALE_DOC_ROW');
  });

  it('flags an undocumented workspace package', () => {
    const rows = extractPackageRows(parseTables(SAMPLE_DOC));
    const packages = makePackages();
    packages.set('packages/secrets/', { name: '@iln/secrets', version: '1.0.0', private: false });
    const findings = buildFindings(rows, packages);
    const hit = findings.find((f) => f.code === 'UNDOCUMENTED_PACKAGE');
    assert.ok(hit, 'expected UNDOCUMENTED_PACKAGE');
  });
});
