// @ts-check
/** @type {import("syncpack").RcFile} */
const config = {
  semverGroups: [
    {
      // All workspace packages must use the same version range
      label: 'Enforce consistent ranges',
      packages: ['**'],
      dependencyTypes: ['dev', 'prod'],
      range: '^',
    },
  ],
  versionGroups: [
    {
      // References between workspace packages (e.g. "workspace:*" or
      // "file:../../sdk") intentionally don't match the referenced
      // package's own declared "version" field — that's how local linking
      // works, not a drift bug.
      label: 'Local workspace package references',
      packages: ['**'],
      dependencies: ['$LOCAL'],
      isIgnored: true,
    },
    {
      // docs/ (legacy Nextra 2 site) and packages/docs (app-router,
      // Nextra 4) are intentionally pinned to different major versions.
      label: 'nextra (intentionally split across legacy and current docs sites)',
      packages: ['**'],
      dependencies: ['nextra', 'nextra-theme-docs'],
      isIgnored: true,
    },
    {
      label: '@stellar/stellar-sdk',
      packages: ['**'],
      dependencies: ['@stellar/stellar-sdk'],
      policy: 'sameRange',
    },
    {
      label: 'typescript',
      packages: ['**'],
      dependencies: ['typescript'],
      policy: 'sameRange',
    },
    {
      label: '@types/node',
      packages: ['**'],
      dependencies: ['@types/node'],
      policy: 'sameRange',
    },
    {
      label: 'commander',
      packages: ['**'],
      dependencies: ['commander'],
      policy: 'sameRange',
    },
    {
      label: 'ts-node',
      packages: ['**'],
      dependencies: ['ts-node'],
      policy: 'sameRange',
    },
    {
      label: 'vitest',
      packages: ['**'],
      dependencies: ['vitest', '@vitest/coverage-v8'],
      policy: 'sameRange',
    },
  ],
};

module.exports = config;
