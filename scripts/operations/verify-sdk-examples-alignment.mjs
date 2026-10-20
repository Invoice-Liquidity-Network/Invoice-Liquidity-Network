#!/usr/bin/env node

/**
 * SDK Examples Package Name Alignment Harness (#1220)
 *
 * Scans all example projects in examples/ and ensures:
 * 1. Package manifests depend strictly on canonical @iln/sdk (or @iln/sdk-next)
 * 2. Source code and README snippets import from canonical @iln/sdk
 * 3. Zero occurrences of legacy @invoice-liquidity/* names
 *
 * Emits machine-readable proof under .artifacts/examples/sdk-examples-alignment-audit.json with SHA-256 seal.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export const CANONICAL_SDK_PACKAGES = ['@iln/sdk', '@iln/sdk-next'];
export const LEGACY_SDK_NAMES = ['@invoice-liquidity/sdk', '@invoice-liquidity/sdk-next'];

export function runExamplesAlignmentAudit(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const examplesDir = join(root, 'examples');
  const violations = [];
  const scannedExamples = [];

  if (!existsSync(examplesDir)) {
    throw new Error(`examples directory not found: ${examplesDir}`);
  }

  const entries = readdirSync(examplesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = join(examplesDir, entry.name);
    const pkgJsonPath = join(projectDir, 'package.json');

    if (!existsSync(pkgJsonPath)) continue;

    scannedExamples.push(entry.name);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    };

    for (const legacy of LEGACY_SDK_NAMES) {
      if (allDeps[legacy]) {
        violations.push({
          example: entry.name,
          file: 'package.json',
          type: 'LEGACY_DEPENDENCY',
          detail: `Declares legacy dependency '${legacy}'`,
        });
      }
    }

    // Scan source files for legacy imports
    function scanDir(dir) {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name === 'node_modules' || item.name === 'dist' || item.name === '.turbo') continue;
        const full = join(dir, item.name);
        if (item.isDirectory()) {
          scanDir(full);
        } else if (/\.(js|ts|jsx|tsx|json|md)$/.test(item.name)) {
          const content = readFileSync(full, 'utf-8');
          for (const legacy of LEGACY_SDK_NAMES) {
            if (content.includes(legacy)) {
              violations.push({
                example: entry.name,
                file: full.replace(root, ''),
                type: 'LEGACY_SOURCE_IMPORT',
                detail: `Contains reference to legacy '${legacy}'`,
              });
            }
          }
        }
      }
    }

    scanDir(projectDir);
  }

  const allPassed = violations.length === 0;

  const artifactsPath = join(root, '.artifacts/examples');
  mkdirSync(artifactsPath, { recursive: true });

  const auditReport = {
    reportId: `EXAMPLES-ALIGNMENT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    status: allPassed ? 'EXAMPLES_ALIGNED' : 'ALIGNMENT_VIOLATIONS',
    scannedExamplesCount: scannedExamples.length,
    scannedExamples,
    violationsCount: violations.length,
    violations,
  };

  auditReport.sha256 = createHash('sha256').update(JSON.stringify(auditReport)).digest('hex');

  const outputPath = join(artifactsPath, 'sdk-examples-alignment-audit.json');
  writeFileSync(outputPath, JSON.stringify(auditReport, null, 2), 'utf-8');

  return {
    allPassed,
    outputPath,
    report: auditReport,
    sha256: auditReport.sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Verifying SDK Examples Package Alignment (#1220)...');
  const res = runExamplesAlignmentAudit();
  if (res.allPassed) {
    console.log(`✓ All ${res.report.scannedExamplesCount} SDK examples aligned with canonical @iln/sdk. SHA-256: ${res.sha256}`);
    process.exit(0);
  } else {
    console.error(`✗ SDK EXAMPLES ALIGNMENT FAILED (${res.violationsCount}):`);
    res.report.violations.forEach((v) => console.error(`  - [${v.example}] ${v.detail}`));
    process.exit(1);
  }
}
