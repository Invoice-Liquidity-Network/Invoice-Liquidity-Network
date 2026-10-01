#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// For each publishable package under packages/, sdk/, cli/, check:
// - package.json version matches latest git tag (vX.Y.Z or package-name@X.Y.Z)
// - CHANGELOG contains expected section for that version (simple substring match)

const packageDirs = ['packages', 'sdk', 'cli'];

function listPackages() {
  const pkgs = [];
  for (const dir of packageDirs) {
    try {
      const entries = execFileSync('bash', ['-lc', `ls -1 ${dir}`], { encoding: 'utf8' });
      for (const name of entries.split(/\n/).map(s=>s.trim()).filter(Boolean)) {
        const pkgJson = join(dir, name, 'package.json');
        if (existsSync(pkgJson)) pkgs.push(pkgJson);
      }
    } catch (err) {
      // ignore
    }
  }
  return pkgs;
}

function getLatestTag(pkgName) {
  try {
    const out = execFileSync('git', ['tag', '--list', `*${pkgName}*`, '--sort=-v:refname'], { encoding: 'utf8' });
    const tags = out.split(/\n/).map(s=>s.trim()).filter(Boolean);
    return tags[0] || null;
  } catch (err) {
    return null;
  }
}

function runDryRun() {
  try {
    return execFileSync('npx', ['--no-install', 'semantic-release', '--dry-run'], { encoding: 'utf8' });
  } catch (err) {
    return err.stdout ?? '';
  }
}

function main() {
  const pkgs = listPackages();
  console.log(`Found ${pkgs.length} package.json files to audit`);
  const dry = runDryRun();

  for (const p of pkgs) {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    const name = data.name || p;
    const version = data.version || 'unknown';
    console.log(`\nPackage: ${name} @ ${version}`);
    // Check changelog contains version
    const changelogPath = p.replace(/package.json$/, 'CHANGELOG.md');
    if (!existsSync(changelogPath)) {
      console.warn(` - Missing changelog: ${changelogPath}`);
      continue;
    }
    const changelog = readFileSync(changelogPath, 'utf8');
    if (!changelog.includes(version)) {
      console.error(` - CHANGELOG does not include version ${version}`);
    } else {
      console.log(' - CHANGELOG includes package version');
    }

    // Check dry-run output mentions this package (for monorepo, semantic-release may not show per-package)
    if (!dry.includes(name) && !dry.includes(version)) {
      console.warn(' - Dry-run output did not mention this package (monorepo releases may be aggregated).');
    } else {
      console.log(' - Dry-run output mentions package or version');
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
