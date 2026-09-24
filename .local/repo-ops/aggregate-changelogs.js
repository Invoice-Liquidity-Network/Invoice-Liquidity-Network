#!/usr/bin/env node

/**
 * Changelog Aggregation Engine
 * Parses CHANGELOG.md files, extracts versions/dates, and merges with semantic labels
 * Exit code 0 on success, 1 on error
 */

const fs = require('fs');
const path = require('path');

const COMPONENT_LABELS = {
  'smart-contract': 'Smart Contract',
  'frontend': 'Frontend',
  'sdk': 'SDK',
  'backend': 'Backend',
  'cli': 'CLI',
  'indexer': 'Indexer',
  'notifications': 'Notifications',
  'oracle-service': 'Oracle Service',
  'shared': 'Shared',
  'react': 'React',
  'docs': 'Docs',
  'mock-backend': 'Mock Backend',
  'opentelemetry': 'OpenTelemetry',
  'test-utils': 'Test Utils',
  'upgrade-tests': 'Upgrade Tests'
};

// Workspace package changelog sources.
// Only list paths that actually contain a CHANGELOG.md; the script
// skips missing files with a warning.  Keep this list in sync with
// pnpm-workspace.yaml.
const CHANGELOG_SOURCES = [
  { path: './CHANGELOG.md', label: 'Smart Contract' },
  { path: './sdk/CHANGELOG.md', label: 'SDK' },
  { path: './cli/CHANGELOG.md', label: 'CLI' },
  { path: './indexer/CHANGELOG.md', label: 'Indexer' },
  { path: './notifications/CHANGELOG.md', label: 'Notifications' },
  { path: './oracle-service/CHANGELOG.md', label: 'Oracle Service' },
  { path: './packages/shared/CHANGELOG.md', label: 'Shared' },
  { path: './packages/react/CHANGELOG.md', label: 'React' },
  { path: './packages/sdk/CHANGELOG.md', label: 'SDK (packages)' },
  { path: './packages/docs/CHANGELOG.md', label: 'Docs' }
];

/**
 * Parse a markdown changelog into structured entries.
 * Handles both dated releases (## [x.y.z] - YYYY-MM-DD) and the
 * special ## [Unreleased] section (no date — placed at the top).
 */
function parseChangelog(content, sourceLabel) {
  const entries = [];
  
  // Dated releases: ## [x.y.z] - YYYY-MM-DD
  const versionRegex = /^##\s+\[([^\]]+)\]\s+-\s+(\d{4}-\d{2}-\d{2})/gm;
  let match;
  while ((match = versionRegex.exec(content)) !== null) {
    entries.push({
      version: match[1],
      date: match[2],
      label: sourceLabel,
      timestamp: new Date(match[2]).getTime()
    });
  }
  
  // [Unreleased] section (no date) — place at timestamp +1 day
  // so it sorts above all dated entries.
  const unreleasedRegex = /^##\s+\[Unreleased\]/m;
  if (unreleasedRegex.test(content)) {
    entries.unshift({
      version: 'Unreleased',
      date: null,
      label: sourceLabel,
      // Use a future timestamp so it always sorts first
      timestamp: Date.now() + 86400000
    });
  }
  
  return entries;
}

/**
 * Merge and sort entries by date descending
 */
function mergeAndSort(allEntries) {
  return allEntries.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Extract the body content between a ## heading and the next ## heading
 * (or end of file).  Returns the lines (with the heading stripped).
 */
function extractSection(content, headingPattern) {
  const lines = content.split('\n');
  let capturing = false;
  const result = [];
  for (const line of lines) {
    if (line.match(headingPattern)) {
      capturing = true;
      continue; // skip the heading itself
    }
    if (capturing && line.match(/^##\s/)) {
      break; // next section
    }
    if (capturing) {
      result.push(line);
    }
  }
  return result.join('\n').trim();
}

/**
 * Generate unified markdown with grouped releases.
 * @param {Array} entries - parsed version entries from all sources
 * @param {string[]} allContents - raw markdown from each source, in order
 */
function generateMarkdown(entries, allContents) {
  if (!entries || entries.length === 0) {
    return `# Changelog\n\nNo releases found.\n`;
  }

  let output = `# Changelog\n\n`;
  output += `All notable changes to this project will be documented in this file.\n\n`;
  output += `The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),\n`;
  output += `and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n`;

  // ── Unreleased section ──────────────────────────────────────────────
  const unreleased = entries.filter(e => e.version === 'Unreleased');
  if (unreleased.length > 0) {
    output += `## [Unreleased]\n\n`;
    unreleased.forEach(entry => {
      output += `### ${entry.label}\n\n`;
      // Extract the body of the [Unreleased] section from each source
      // that has one.
      allContents.forEach((content, idx) => {
        const body = extractSection(content, /^##\s+\[Unreleased\]/);
        if (body && entry.label === CHANGELOG_SOURCES[idx]?.label) {
          output += body + '\n\n';
        }
      });
    });
  }

  // ── Dated releases grouped by date ─────────────────────────────────
  const dated = entries.filter(e => e.version !== 'Unreleased');
  const groupedByDate = {};
  dated.forEach(entry => {
    if (!groupedByDate[entry.date]) {
      groupedByDate[entry.date] = [];
    }
    groupedByDate[entry.date].push(entry);
  });

  const sortedDates = Object.keys(groupedByDate).sort().reverse();

  sortedDates.forEach(date => {
    const versionGroup = groupedByDate[date];
    output += `## Release: ${date}\n\n`;

    versionGroup.forEach(entry => {
      output += `### [${entry.version}] - ${entry.label}\n\n`;
    });
  });

  // ── Full release history ───────────────────────────────────────────
  output += `---\n\n`;
  output += `## Full Release History\n\n`;

  // Extract release sections from each source and deduplicate
  // by version+label key.
  const seen = new Set();
  allContents.forEach((content, idx) => {
    const label = CHANGELOG_SOURCES[idx]?.label || 'Unknown';
    const lines = content.split('\n');
    let inSection = false;
    let currentVersion = null;
    const sectionLines = [];

    for (const line of lines) {
      const versionMatch = line.match(/^##\s+\[([^\]]+)\]\s*-/);
      if (versionMatch) {
        // Flush previous section
        if (inSection && currentVersion) {
          const key = `${currentVersion}|${label}`;
          if (!seen.has(key)) {
            seen.add(key);
            output += sectionLines.join('\n') + '\n\n';
          }
          sectionLines.length = 0;
        }
        currentVersion = versionMatch[1];
        inSection = true;
        sectionLines.push(line);
      } else if (inSection) {
        sectionLines.push(line);
      }
    }
    // Flush last section
    if (inSection && currentVersion) {
      const key = `${currentVersion}|${label}`;
      if (!seen.has(key)) {
        seen.add(key);
        output += sectionLines.join('\n') + '\n\n';
      }
    }
  });

  return output;
}

/**
 * Main execution
 */
async function main() {
  try {
    const workspaceRoot = process.cwd();
    const allEntries = [];
    const allContents = [];

    for (const source of CHANGELOG_SOURCES) {
      const filePath = path.join(workspaceRoot, source.path);

      if (!fs.existsSync(filePath)) {
        // Not an error — package may not have a changelog yet.
        // Only warn for the root changelog.
        if (source.path === './CHANGELOG.md') {
          console.warn(`⚠  Root changelog not found: ${source.path}`);
        }
        allContents.push(''); // keep index in sync
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      allContents.push(content);
      const entries = parseChangelog(content, source.label);
      allEntries.push(...entries);

      console.log(`✓ Parsed ${entries.length} version(s) from ${source.path} (label: ${source.label})`);
    }

    const merged = mergeAndSort(allEntries);
    const markdown = generateMarkdown(merged, allContents);

    const outputPath = path.join(workspaceRoot, 'docs', 'changelog.md');
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, markdown, 'utf8');

    console.log(`✓ Generated unified changelog: ${outputPath}`);
    console.log(`✓ Total versions aggregated: ${merged.length}`);

    process.exit(0);
  } catch (error) {
    console.error(`✗ Aggregation failed: ${error.message}`);
    process.exit(1);
  }
}

main();
