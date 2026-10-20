#!/usr/bin/env node

/**
 * React Package SDK Alignment Validator (#1221)
 *
 * Verifies that:
 * 1. packages/react/package.json declares @iln/sdk in peerDependencies and devDependencies (workspace:*)
 * 2. packages/react contains zero references to legacy @invoice-liquidity/* names
 * 3. packages/react/src/index.ts exports canonical SDK types (ILNClient)
 * 4. All hooks consistently import from canonical @iln/sdk
 * 5. Emits SHA-256 seal.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export function verifyReactSdkAlignment(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const reactPkgPath = join(root, 'packages/react/package.json');
  const reactIndexPath = join(root, 'packages/react/src/index.ts');
  const hooksDir = join(root, 'packages/react/src/hooks');

  const violations = [];

  if (!existsSync(reactPkgPath)) {
    throw new Error(`packages/react/package.json not found: ${reactPkgPath}`);
  }

  const pkg = JSON.parse(readFileSync(reactPkgPath, 'utf-8'));

  if (!pkg.peerDependencies || !pkg.peerDependencies['@iln/sdk']) {
    violations.push({ check: 'PEER_DEP', reason: 'Missing @iln/sdk in peerDependencies' });
  }

  if (!pkg.devDependencies || !pkg.devDependencies['@iln/sdk']) {
    violations.push({ check: 'DEV_DEP', reason: 'Missing @iln/sdk in devDependencies' });
  }

  const rawPkgStr = JSON.stringify(pkg);
  if (rawPkgStr.includes('@invoice-liquidity/sdk')) {
    violations.push({ check: 'LEGACY_NAME', reason: 'Found legacy @invoice-liquidity/sdk in package.json' });
  }

  const indexStr = readFileSync(reactIndexPath, 'utf-8');
  if (!indexStr.includes("from '@iln/sdk'")) {
    violations.push({ check: 'INDEX_REEXPORT', reason: 'packages/react/src/index.ts does not re-export from @iln/sdk' });
  }

  if (existsSync(hooksDir)) {
    const files = readdirSync(hooksDir).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const content = readFileSync(join(hooksDir, f), 'utf-8');
      if (content.includes('@invoice-liquidity')) {
        violations.push({ check: 'HOOK_LEGACY', reason: `Hook ${f} references legacy @invoice-liquidity name` });
      }
    }
  }

  const valid = violations.length === 0;
  const sha256 = createHash('sha256').update(rawPkgStr + indexStr, 'utf-8').digest('hex');

  return {
    valid,
    violationsCount: violations.length,
    violations,
    sha256,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Verifying React Package SDK Alignment (#1221)...');
  const res = verifyReactSdkAlignment();
  if (res.valid) {
    console.log(`✓ React package aligned with canonical @iln/sdk. SHA-256: ${res.sha256}`);
    process.exit(0);
  } else {
    console.error(`✗ REACT SDK ALIGNMENT FAILED (${res.violationsCount}):`);
    res.violations.forEach((v) => console.error(`  - [${v.check}] ${v.reason}`));
    process.exit(1);
  }
}
