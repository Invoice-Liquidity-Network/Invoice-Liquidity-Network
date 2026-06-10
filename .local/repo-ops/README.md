# Repository Operations - Changelog Aggregation

This directory contains automation scripts and reference documentation for managing the cross-repository changelog aggregation system implemented for Issue #314.

## Contents

### Scripts

#### `aggregate-changelogs.js`
Zero-dependency Node.js script that aggregates CHANGELOG.md files into a unified docs/changelog.md page.

**Usage**:
```bash
node aggregate-changelogs.js
```

**Exit Codes**:
- `0`: Success - changelog generated
- `1`: Failure - file not found or parse error

**Configuration**:
- Edit `CHANGELOG_SOURCES` array to add/remove sources
- Edit `COMPONENT_LABELS` object to customize labels

#### `test-changelog-aggregation.sh`
Comprehensive test suite validating aggregation engine and acceptance criteria.

**Usage**:
```bash
bash test-changelog-aggregation.sh
```

**Tests Performed**:
- Script execution and exit codes
- File generation
- Markdown syntax validation
- Header format verification
- Link validation
- Component label detection

**Exit Codes**:
- `0`: All tests passed
- `1`: One or more tests failed

### Documentation

#### `QUICK_REFERENCE.md`
Quick command reference with single-line execution examples.

**Sections**:
- Single-command summaries
- File creation/modification checklist
- Acceptance criteria checklist
- Conventional commit examples
- Exit code reference
- Troubleshooting quick links

## Quick Start

### 1. Run Aggregation
```bash
node aggregate-changelogs.js
```

### 2. Run Tests
```bash
bash test-changelog-aggregation.sh
```

### 3. View Generated Changelog
```bash
cat ../docs/changelog.md
```

## Configuration

### Add Changelog Source

Edit `aggregate-changelogs.js`:
```javascript
const CHANGELOG_SOURCES = [
  { path: './CHANGELOG.md', label: 'Smart Contract' },
  { path: './sdk/CHANGELOG.md', label: 'SDK' },
  { path: './frontend/CHANGELOG.md', label: 'Frontend' },
];
```

### Customize Component Labels

Edit `aggregate-changelogs.js`:
```javascript
const COMPONENT_LABELS = {
  'smart-contract': 'Smart Contract',
  'frontend': 'Frontend',
  'sdk': 'SDK',
  'backend': 'Backend',
  'cli': 'CLI',
  'indexer': 'Indexer',
  'notifications': 'Notifications',
  // Add more labels here
};
```

## Troubleshooting

### Script Not Found
```bash
ls -la aggregate-changelogs.js
```

### Node.js Missing
```bash
node --version  # Must be >=18
```

### Changelog Not Generated
```bash
node aggregate-changelogs.js
echo "Exit code: $?"
```

### Tests Failing
```bash
bash test-changelog-aggregation.sh 2>&1 | head -50
```

## References

- **Issue**: #314 - Create a changelog page on the docs site
- **Main Guide**: `../../DEPLOYMENT_GUIDE.md`
- **Implementation Details**: `../../docs/CHANGELOG_IMPLEMENTATION.md`
- **Quick Commands**: `./QUICK_REFERENCE.md`

## Standards

- **Keep a Changelog**: https://keepachangelog.com/en/1.0.0/
- **Semantic Versioning**: https://semver.org/spec/v2.0.0.html
- **Conventional Commits**: https://www.conventionalcommits.org/

---

**Status**: ✅ Production Ready  
**Last Updated**: 2026-06-02
