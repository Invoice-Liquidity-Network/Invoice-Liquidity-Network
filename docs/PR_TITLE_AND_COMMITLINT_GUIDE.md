# Commitlint and PR Title Lint Consistency Guide

## Objective
Establish cohesive linting rules between GitHub Actions PR title verification (`.github/workflows/pr-title-lint.yml`) and local commit message enforcement (`commitlint.config.js`).

## Specification
- Enforce Conventional Commits specification: `type(scope): description`.
- Canonical types allowed: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Standalone closing issue reference on separate line: `Closes #<issue_number>`.

## Local Testing
```bash
npx commitlint --from=HEAD~1
```
