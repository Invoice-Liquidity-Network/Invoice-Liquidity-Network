import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import semver from 'semver';

function runCmd(cmd: string, cwd = process.cwd()) {
  console.log(`Running: ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd });
}

function getLatestTag(): string | null {
  try {
    const stdout = execSync('git describe --tags --abbrev=0 --match "@iln/scripts@*"', {
      encoding: 'utf-8',
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

function getCommitsSinceLastTag(lastTag: string | null): string[] {
  try {
    const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
    const stdout = execSync(`git log ${range} --format="%s" -- packages/scripts`, {
      encoding: 'utf-8',
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('chore(release):'));
  } catch (error) {
    console.error('Failed to get git log:', error);
    return [];
  }
}

export async function runRelease(bumpType: 'major' | 'minor' | 'patch') {
  const pkgPath = path.resolve(__dirname, '../package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version;
  const newVersion = semver.inc(currentVersion, bumpType);

  if (!newVersion) {
    throw new Error(`Invalid version increment from ${currentVersion} using ${bumpType}`);
  }

  console.log(`Bumping @iln/scripts from ${currentVersion} to ${newVersion}...`);

  // 1. Version Bump
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log('✓ Updated package.json version.');

  // 2. Changelog Generation
  const lastTag = getLatestTag();
  console.log(`Generating changelog since tag: ${lastTag || 'initial commit'}`);
  const commits = getCommitsSinceLastTag(lastTag);

  const groups: Record<string, string[]> = {
    Added: [],
    Changed: [],
    Fixed: [],
    Security: [],
  };

  commits.forEach((commit) => {
    if (commit.toLowerCase().startsWith('feat')) {
      groups.Added.push(commit);
    } else if (commit.toLowerCase().startsWith('fix')) {
      groups.Fixed.push(commit);
    } else if (commit.toLowerCase().startsWith('sec')) {
      groups.Security.push(commit);
    } else {
      groups.Changed.push(commit);
    }
  });

  const dateStr = new Date().toISOString().split('T')[0];
  let changelogSection = `## [${newVersion}] - ${dateStr}\n\n`;

  let hasEntries = false;
  for (const [groupName, items] of Object.entries(groups)) {
    if (items.length > 0) {
      changelogSection += `### ${groupName}\n`;
      items.forEach((item) => {
        changelogSection += `- ${item}\n`;
      });
      changelogSection += '\n';
      hasEntries = true;
    }
  }

  if (!hasEntries) {
    changelogSection += `### Changed\n- Maintenance updates\n\n`;
  }

  const changelogPath = path.resolve(__dirname, '../CHANGELOG.md');
  const header = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

  let changelogContent = '';
  if (fs.existsSync(changelogPath)) {
    changelogContent = fs.readFileSync(changelogPath, 'utf-8');
  }

  if (!changelogContent.startsWith('# Changelog')) {
    changelogContent = header + changelogSection;
  } else {
    const firstHeaderIndex = changelogContent.indexOf('## [');
    if (firstHeaderIndex === -1) {
      changelogContent = changelogContent.trimEnd() + '\n\n' + changelogSection;
    } else {
      changelogContent =
        changelogContent.substring(0, firstHeaderIndex) +
        changelogSection +
        changelogContent.substring(firstHeaderIndex);
    }
  }

  fs.writeFileSync(changelogPath, changelogContent.trim() + '\n', 'utf-8');
  console.log('✓ Updated CHANGELOG.md.');

  // 3. Git Tagging and Commit
  const tag = `@iln/scripts@${newVersion}`;
  try {
    const packageScriptsDir = path.resolve(__dirname, '..');
    runCmd('git add package.json CHANGELOG.md', packageScriptsDir);
    runCmd(`git commit -m "chore(release): @iln/scripts@${newVersion}"`, packageScriptsDir);
    runCmd(`git tag -a "${tag}" -m "Release ${tag}"`, packageScriptsDir);
    console.log(`✓ Committed and tagged release as ${tag}.`);
  } catch (err) {
    console.error(
      'Failed to commit/tag in Git. Make sure your git working directory is clean or repository is initialized.'
    );
  }

  // 4. Git Push
  try {
    runCmd('git push origin HEAD && git push origin --tags');
    console.log('✓ Pushed changes and tags to remote.');
  } catch (err) {
    console.warn('Could not automatically push to remote origin. Please push tags manually.');
  }
}

// Support running the script directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const bumpType = args[0] as 'major' | 'minor' | 'patch';

  if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
    console.error('Usage: ts-node src/release.ts <major|minor|patch>');
    process.exit(1);
  }

  runRelease(bumpType)
    .then(() => {
      console.log('Release process completed.');
    })
    .catch((err) => {
      console.error('Release failed:', err);
      process.exit(1);
    });
}
