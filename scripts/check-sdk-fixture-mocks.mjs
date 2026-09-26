#!/usr/bin/env node

/**
 * check-sdk-fixture-mocks.mjs
 *
 * Closes issue #1093 (docs/sdk-integration-fixture-audit.md): fails CI if an
 * SDK integration test introduces a new mock of a live-chain interaction
 * (stubbed `fetch`, a mocked `@stellar/stellar-sdk` import, or a `Mock*`
 * class standing in for a wallet/RPC/Horizon/network dependency) that isn't
 * declared in the audit doc's allowlist. This is deliberately regex-based
 * (no AST dependency) so it stays fast and dependency-free, matching the
 * repo's other scripts/check-*.mjs conventions.
 *
 * Usage:  node scripts/check-sdk-fixture-mocks.mjs
 * Exit 0 = clean (every detected mock is documented), exit 1 = undocumented
 * mock(s) found, exit 2 = the audit doc's allowlist block is missing/malformed.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

export const AUDIT_DOC_PATH = join(REPO_ROOT, 'docs', 'sdk-integration-fixture-audit.md');

// Directories that may legitimately contain SDK integration test fixtures or
// live-chain mocks. Anything under these roots is scanned.
export const SCAN_ROOTS = [
  join(REPO_ROOT, 'tests', 'sdk-integration', 'src'),
  join(REPO_ROOT, 'sdk', 'src', 'integration'),
  join(REPO_ROOT, 'sdk', 'src', 'e2e'),
  join(REPO_ROOT, 'packages', 'sdk', 'src'),
];

// Patterns that indicate a file mocks a live-chain interaction rather than
// exercising it for real. Kept intentionally narrow: generic test helpers
// (random data generators, assertion helpers) should not trip this.
const MOCK_PATTERNS = [
  /globalThis(?:\s+as\s+any)?\s*\)?\s*\.\s*fetch\s*=/,
  /\bglobal\.fetch\s*=/,
  /\bvi\.mock\(\s*['"]@stellar\/stellar-sdk/,
  /\bjest\.mock\(\s*['"]@stellar\/stellar-sdk/,
  /\bclass\s+Mock(Wallet|Network|Rpc|RpcServer|Server|Horizon|Signer)\b/,
];

/**
 * Parses the `## Documented mocks (CI allowlist)` fenced block out of the
 * audit doc. Lines are repo-relative POSIX paths, one per line; blank lines
 * and `#`-prefixed comments are ignored.
 */
export function parseAllowlist(markdown) {
  const match = markdown.match(
    /## Documented mocks \(CI allowlist\)[\s\S]*?```(?:text)?\n([\s\S]*?)```/
  );
  if (!match) {
    return null;
  }
  return new Set(
    match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  );
}

/**
 * Given a Map of repo-relative path -> file contents, returns the set of
 * paths that match at least one live-chain mock pattern.
 */
export function detectMocks(fileMap) {
  const detected = new Set();
  for (const [relPath, contents] of fileMap) {
    if (MOCK_PATTERNS.some((pattern) => pattern.test(contents))) {
      detected.add(relPath);
    }
  }
  return detected;
}

/**
 * Compares detected mocks against the documented allowlist.
 * Returns { undocumented, stale } (both arrays, sorted).
 */
export function diffAgainstAllowlist(detected, allowlist) {
  const undocumented = [...detected].filter((f) => !allowlist.has(f)).sort();
  const stale = [...allowlist].filter((f) => !detected.has(f)).sort();
  return { undocumented, stale };
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // directory doesn't exist — skip
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|mts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
}

function loadFileMap() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    walk(root, files);
  }
  const map = new Map();
  for (const file of files) {
    map.set(relative(REPO_ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8'));
  }
  return map;
}

function main() {
  const markdown = readFileSync(AUDIT_DOC_PATH, 'utf8');
  const allowlist = parseAllowlist(markdown);

  if (allowlist === null) {
    console.error(
      `❌ Could not find a "## Documented mocks (CI allowlist)" fenced block in ${relative(
        REPO_ROOT,
        AUDIT_DOC_PATH
      )}`
    );
    process.exit(2);
  }

  const fileMap = loadFileMap();
  const detected = detectMocks(fileMap);
  const { undocumented, stale } = diffAgainstAllowlist(detected, allowlist);

  if (stale.length > 0) {
    console.warn(
      `⚠️  ${stale.length} allowlist entr${stale.length === 1 ? 'y is' : 'ies are'} stale (no longer detected as a live-chain mock) — consider removing from the audit doc:\n` +
        stale.map((f) => `   - ${f}`).join('\n')
    );
  }

  if (undocumented.length === 0) {
    console.log(
      `✅ No undocumented live-chain mocks found (${detected.size} documented mock(s) scanned across ${SCAN_ROOTS.length} root(s)).`
    );
    process.exit(0);
  }

  console.error(
    `\n❌ Found ${undocumented.length} undocumented mock(s) of a live-chain interaction:\n`
  );
  for (const f of undocumented) {
    console.error(`  ${f}`);
  }
  console.error(
    '\nEvery mock of a live-chain interaction (stubbed fetch, a mocked @stellar/stellar-sdk\n' +
      'import, or a MockWallet/MockNetwork/MockRpc/MockHorizon/MockSigner class) must be\n' +
      `documented in the "Documented mocks (CI allowlist)" block of\n` +
      `${relative(REPO_ROOT, AUDIT_DOC_PATH)}, with a justification for why it is not backed\n` +
      'by a live testnet fixture. Add the file path to that block, or replace the mock with\n' +
      'a live testnet-backed fixture (see sdk/src/integration/testnet.test.ts for the pattern).'
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
