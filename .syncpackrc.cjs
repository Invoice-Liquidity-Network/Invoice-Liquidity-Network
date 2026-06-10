// @ts-check
/** @type {import("syncpack").RcFile} */
const config = {
  semverGroups: [
    {
      // All workspace packages must use the same version range
      label: "Enforce consistent ranges",
      packages: ["**"],
      dependencyTypes: ["dev", "prod"],
      range: "^",
    },
  ],
  versionGroups: [
    {
      label: "@stellar/stellar-sdk",
      packages: ["**"],
      dependencies: ["@stellar/stellar-sdk"],
      policy: "sameRange",
    },
    {
      label: "typescript",
      packages: ["**"],
      dependencies: ["typescript"],
      policy: "sameRange",
    },
    {
      label: "@types/node",
      packages: ["**"],
      dependencies: ["@types/node"],
      policy: "sameRange",
    },
    {
      label: "commander",
      packages: ["**"],
      dependencies: ["commander"],
      policy: "sameRange",
    },
    {
      label: "ts-node",
      packages: ["**"],
      dependencies: ["ts-node"],
      policy: "sameRange",
    },
    {
      label: "vitest",
      packages: ["**"],
      dependencies: ["vitest", "@vitest/coverage-v8"],
      policy: "sameRange",
    },
  ],
};

module.exports = config;
