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
  'notifications': 'Notifications'
};

const CHANGELOG_SOURCES = [
  { path: './CHANGELOG.md', label: 'Smart Contract' }
];

/**
 * Parse a markdown changelog into structured entries
 */
function parseChangelog(content, sourceLabel) {
  const entries = [];
  const versionRegex = /^##\s+\[([^\]]+)\]\s+-\s+(\d{4}-\d{2}-\d{2})/gm;
  
  let match;
  while ((match = versionRegex.exec(content)) !== null) {
    const version = match[1];
    const date = match[2];
    
    entries.push({
      version,
      date,
      label: sourceLabel,
      timestamp: new Date(date).getTime()
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
 * Generate unified markdown with grouped releases
 */
function generateMarkdown(entries, content) {
  if (!entries || entries.length === 0) {
    return `# Changelog\n\nNo releases found.\n`;
  }

  let output = `# Changelog\n\n`;
  output += `All notable changes to this project will be documented in this file.\n\n`;
  output += `The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),\n`;
  output += `and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n`;

  const groupedByDate = {};
  entries.forEach(entry => {
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

  output += `---\n\n`;
  output += `## Full Release History\n\n`;
  
  const lines = content.split('\n');
  let inReleaseSection = false;
  const releaseContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.match(/^##\s+\[[\d.]+\]/)) {
      inReleaseSection = true;
    }

    if (inReleaseSection) {
      releaseContent.push(line);
    }
  }

  output += releaseContent.join('\n');
  
  return output;
}

/**
 * Main execution
 */
async function main() {
  try {
    const workspaceRoot = process.cwd();
    const allEntries = [];
    let sourceContent = '';

    for (const source of CHANGELOG_SOURCES) {
      const filePath = path.join(workspaceRoot, source.path);

      if (!fs.existsSync(filePath)) {
        console.warn(`⚠  Changelog not found: ${source.path}`);
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      sourceContent = content;
      const entries = parseChangelog(content, source.label);
      allEntries.push(...entries);

      console.log(`✓ Parsed ${entries.length} versions from ${source.path} (label: ${source.label})`);
    }

    const merged = mergeAndSort(allEntries);
    const markdown = generateMarkdown(merged, sourceContent);

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
