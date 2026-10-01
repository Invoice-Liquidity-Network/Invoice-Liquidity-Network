#!/usr/bin/env node

/**
 * Fails if any npm (`package-lock.json`) or yarn (`yarn.lock`) lockfile is
 * present anywhere in the repo. This is a pnpm workspace and must have
 * exactly one lockfile: the root `pnpm-lock.yaml`.
 *
 * Usage: node scripts/check-no-foreign-lockfiles.mjs
 */

import { readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const FORBIDDEN_NAMES = new Set(['package-lock.json', 'yarn.lock']);
const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next']);

function walk(dir, found) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry)) continue;
      walk(fullPath, found);
    } else if (FORBIDDEN_NAMES.has(entry)) {
      found.push(fullPath);
    }
  }
}

const found = [];
walk(rootDir, found);

if (found.length > 0) {
  console.error('Found forbidden lockfile(s). This repo uses pnpm exclusively:\n');
  for (const filePath of found) {
    console.error(`  - ${filePath.replace(rootDir + '\\', '').replace(rootDir + '/', '')}`);
  }
  console.error('\nRemove them and use pnpm-lock.yaml at the repo root instead.');
  process.exit(1);
}

console.log('No foreign lockfiles found.');
