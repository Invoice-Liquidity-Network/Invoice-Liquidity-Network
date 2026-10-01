/**
 * Single source of truth for commit message AND PR title linting.
 *
 * Both enforcement points load this file explicitly:
 *   • `.husky/commit-msg`          — `commitlint --config commitlint.config.js`
 *   • `.github/workflows/pr-title-lint.yml` — same, on the PR title
 *
 * Because a PR title and a commit header are validated against the same
 * rules, anything accepted by one is accepted by the other. If you change
 * `type-enum` here, update the table in CONTRIBUTING.md to match, and
 * `pnpm validate:commit-convention` will fail until you do.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      // Must stay identical to the list documented in CONTRIBUTING.md.
      ['feat', 'fix', 'docs', 'chore', 'test', 'refactor', 'perf', 'ci', 'design', 'build'],
    ],
  },
};
