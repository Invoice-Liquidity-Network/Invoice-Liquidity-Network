#!/usr/bin/env node

/**
 * Dependency Confusion Detection Script
 * 
 * This script audits the pnpm workspace for dependency confusion vulnerabilities
 * by checking for unexpected external resolutions of internal package names.
 * 
 * Usage: node scripts/check-dependency-confusion.mjs
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const INTERNAL_SCOPES = ['@iln', '@invoice-liquidity'];
const INTERNAL_UNSCOPED = ['iln-indexer'];

function checkDependencyConfusion() {
  console.log('🔍 Checking for dependency confusion vulnerabilities...\n');
  
  let lockfile;
  try {
    lockfile = readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml'), 'utf-8');
  } catch (error) {
    console.error('❌ Error: Could not read pnpm-lock.yaml');
    console.error(error.message);
    process.exit(1);
  }
  
  const errors = [];
  const warnings = [];
  
  // Check for external resolutions of scoped internal packages
  for (const scope of INTERNAL_SCOPES) {
    // Match patterns like "@iln/package-name:" in lockfile
    const scopePattern = new RegExp(`${scope.replace('/', '\\/')}\/[^:]+:`, 'g');
    const matches = lockfile.match(scopePattern) || [];
    
    for (const match of matches) {
      const pkgName = match.replace(':', '');
      
      // Skip if it's explicitly using workspace: or link: protocol
      const pkgSection = extractPackageSection(lockfile, pkgName);
      if (!pkgSection) continue;
      
      if (pkgSection.includes('workspace:') || pkgSection.includes('link:')) {
        // This is expected for internal packages
        continue;
      }
      
      // Check if it's resolving to external registry
      if (pkgSection.includes('registry.npmjs.org') || pkgSection.includes('resolution:')) {
        errors.push({
          package: pkgName,
          message: `Unexpected external resolution for internal scoped package: ${pkgName}`,
          severity: 'HIGH'
        });
      }
    }
  }
  
  // Check for unscoped internal packages
  for (const pkg of INTERNAL_UNSCOPED) {
    if (lockfile.includes(`${pkg}:`)) {
      const pkgSection = extractPackageSection(lockfile, pkg);
      if (pkgSection && !pkgSection.includes('link:') && !pkgSection.includes('workspace:')) {
        warnings.push({
          package: pkg,
          message: `Unscoped internal package ${pkg} is vulnerable to confusion attack. Consider scoping or publishing placeholder.`,
          severity: 'MEDIUM'
        });
      }
    }
  }
  
  // Report results
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ No dependency confusion vulnerabilities detected.\n');
    console.log(`Checked ${INTERNAL_SCOPES.length} internal scopes and ${INTERNAL_UNSCOPED.length} unscoped packages.`);
    process.exit(0);
  }
  
  if (errors.length > 0) {
    console.error('❌ CRITICAL: Dependency confusion vulnerabilities detected:\n');
    errors.forEach((err, idx) => {
      console.error(`  ${idx + 1}. [${err.severity}] ${err.message}`);
    });
    console.error('\n');
  }
  
  if (warnings.length > 0) {
    console.warn('⚠️  Warnings:\n');
    warnings.forEach((warn, idx) => {
      console.warn(`  ${idx + 1}. [${warn.severity}] ${warn.message}`);
    });
    console.warn('\n');
  }
  
  if (errors.length > 0) {
    console.error('Fix required: Remove external resolutions of internal packages from pnpm-lock.yaml');
    console.error('Run: pnpm install --frozen-lockfile to regenerate lockfile');
    process.exit(1);
  }
  
  if (warnings.length > 0) {
    console.warn('Warnings detected but not blocking. Review and address before mainnet.');
    process.exit(0);
  }
}

/**
 * Extract the section of lockfile pertaining to a specific package
 */
function extractPackageSection(lockfile, packageName) {
  const lines = lockfile.split('\n');
  const startPattern = new RegExp(`^\\s*['"]?${packageName.replace('/', '\\/')}['"]?:`);
  
  let startIndex = -1;
  let endIndex = -1;
  let baseIndent = 0;
  
  // Find start of package section
  for (let i = 0; i < lines.length; i++) {
    if (startPattern.test(lines[i])) {
      startIndex = i;
      baseIndent = lines[i].search(/\S/);
      break;
    }
  }
  
  if (startIndex === -1) return null;
  
  // Find end of package section (next line with same or less indentation)
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    
    const indent = line.search(/\S/);
    if (indent <= baseIndent && indent >= 0) {
      endIndex = i;
      break;
    }
  }
  
  if (endIndex === -1) endIndex = lines.length;
  
  return lines.slice(startIndex, endIndex).join('\n');
}

// Run the check
checkDependencyConfusion();
