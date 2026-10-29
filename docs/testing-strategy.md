# Testing Strategy

This document is the guide to testing Invoice Liquidity Network (ILN) across the project-level repository and its companion repositories. It explains where tests live, which checks run for each change, and how to choose the smallest effective set of tests for a feature.

> **Contributor shortcut:** start with the [decision guide](#decision-guide), then run the relevant local command before opening a pull request.

## Testing principles

- Test behavior at the lowest practical level first.
- Add integration coverage when a change crosses a process, package, database, RPC, or repository boundary.
- Add an end-to-end test when the user-visible workflow or a deployed service is the behavior being changed.
- Keep deterministic, fast tests in the pull-request path. Use nightly or scheduled jobs for tests that require live infrastructure, large datasets, or long execution times.
- Update snapshots and migration expectations intentionally. A snapshot or schema change is part of the review surface, not a way to hide an unrelated change.
- Tests in this repository do not replace the tests in `ILN-Frontend` or `ILN-Smart-Contract`; cross-repository behavior should be covered in the repository that owns the changed behavior, with integration coverage added where the boundary matters.

## Test inventory

| Test type | Typical location | Typical trigger | Owning workspace(s) |
| --- | --- | --- | --- |
| Unit tests | A workspace's source-adjacent `*.test.ts` files; for example `cli/src/__tests__/`, `cli/src/*.test.ts`, `packages/sdk/src/`, `packages/sdk/scripts/__tests__/`, `notifications/tests/`, and `examples/*/*.test.ts` | Every PR | The workspace containing the implementation: CLI, SDK, notifications, examples, and other TypeScript packages |
| Contract unit tests | `ILN-Smart-Contract` Rust test modules and contract test files | Every PR affecting contract code | `ILN-Smart-Contract` |
| Integration tests | Workspace `tests/` directories, such as `cli/tests/integration.test.ts`, plus package boundary tests | Every PR when the affected boundary is changed; some suites require local services | CLI, SDK, indexer, notifications, and the smart-contract integration boundary |
| Database and migration tests | `indexer/tests/migrations.test.ts` and indexer database code in `indexer/src/db.ts` | Every PR affecting indexer schema or persistence; migration workflows also run on migration changes | `indexer` |
| Schema-snapshot tests | `indexer/tests/graphql-schema.test.ts` and its Vitest snapshots | Every PR affecting GraphQL type definitions or resolvers | `indexer` |
| Configuration/schema-drift tests | `cli/tests/config-schema-drift.test.ts` | Every PR affecting CLI configuration or `cli/config.schema.json` | `cli` |
| Browser and SDK E2E tests | `ILN-Frontend` Playwright suites; SDK E2E suites and `docs/sdk-e2e.md`; local-node workflow `.github/workflows/sdk-e2e-local-node.yml` | PRs for affected applications or SDK flows; broader suites nightly or when manually dispatched | `ILN-Frontend`, `packages/sdk`, and the local Soroban fixture |
| Repository E2E tests | `.github/workflows/e2e.yml` and `.github/workflows/e2e-nightly.yml`; associated E2E suites in the owning workspace | PR-triggered for supported smoke coverage; nightly for the broader matrix | Project-level repository, CLI/SDK, indexer, notifications, frontend, and contract integration |
| Load tests | `scripts/load-test.ts`, `scripts/load-test-indexer.ts`, `scripts/load-test-notifications.ts`, and shared code in `scripts/lib/load-test-harness.ts` | Manually, before performance-sensitive releases, and on scheduled capacity checks; not every PR | Project-level scripts, indexer, and notifications |
| Benchmark tests | `indexer/benchmark.ts` and benchmarks in the owning workspace | Scheduled or manual performance runs; run locally when changing hot paths | `indexer` and the workspace owning the measured code |
| Migration tests | `indexer/tests/migrations.test.ts`; deployment and migration automation in `.github/workflows/indexer-migrations.yml` | Every PR for indexer schema changes; scheduled/deployment checks for upgrade paths | `indexer` and the deployment workflow |
| Mutation tests | `packages/sdk/src/errors.test.ts`, `packages/sdk/stryker.config.mjs`, and `.github/workflows/mutation-testing.yml` | Weekly on Sunday, manually, and PRs touching the configured SDK mutation target; advisory/non-blocking | `packages/sdk` |
| Security and dependency checks | Repository scripts and CI workflows such as CodeQL, Snyk, dependency-audit tests, and license checks | Every PR or push where configured; some checks are scheduled | Project-level repository and each affected workspace |
| Documentation and link checks | `docs/` content, `.github/workflows/docs-link-check.yml`, and documentation build workflows | Every PR that changes documentation or documentation tooling | `docs` and project-level repository |

The table describes the normal ownership and trigger. A workflow may select a narrower set of tests based on changed paths, and maintainers may request additional coverage during review.

## Pull-request test layers

### Fast checks: every PR

Run the checks relevant to the changed workspace first:

```bash
pnpm test
pnpm lint
pnpm type-check
pnpm format:check
```

The root `test` command delegates to workspace test tasks through Turbo. A focused workspace command is useful while developing, but the root command is the final check for a cross-workspace change.

For project-level tests, use the scripts defined in the root `package.json`, including:

```bash
pnpm test:checklist
pnpm test:compatibility
pnpm test:audit
```

Run the Rust contract tests in `ILN-Smart-Contract` when contract behavior, generated interfaces, or contract assumptions change:

```bash
cargo test
```

### Integration and E2E checks

Integration tests should be deterministic and use injected clients or in-memory services where possible. The CLI local integration suite is intentionally skipped unless its local fixture environment variables are present; it exercises submit, status, list, fund, and pay against a local Soroban instance when enabled.

E2E tests exercise a real user or service workflow across boundaries. The project uses more than one E2E flavor:

- **Local-node E2E:** starts or connects to a local Soroban node and validates SDK/CLI interaction without relying on a shared network.
- **Application/browser E2E:** validates frontend user journeys with Playwright in the frontend repository.
- **Service/repository E2E:** validates a deployed or assembled set of CLI, SDK, indexer, notifications, and contract components.
- **Nightly or environment-backed E2E:** runs the wider matrix and tests flows that are too expensive or environment-dependent for every PR.

When an E2E test needs credentials, contract IDs, or a live RPC endpoint, document the fixture and keep secrets in CI configuration. Do not commit keys, tokens, generated reports, or local database files.

## Specialized testing

### Load tests and benchmarks

Load tests measure capacity and latency under concurrent work; benchmarks measure a repeatable operation or hot path. They are not substitutes for correctness tests.

Use the shared load-test harness and the service-specific entry points:

```bash
pnpm test:load
pnpm test:load:indexer
pnpm test:load:notifications
```

Run a load test when changing concurrency, polling, event processing, database queries, notification delivery, RPC usage, or another performance-sensitive path. Record the workload, environment, duration, thresholds, and result. Run `indexer/benchmark.ts` for repeatable indexer performance comparisons and treat changes in benchmark output as review data rather than an automatic correctness failure.

### Migration tests

Every database schema change must preserve the expected fresh-database and upgrade behavior. Add or update migration tests in `indexer/tests/migrations.test.ts`, including columns, indexes, defaults, and compatibility with the code in `indexer/src/db.ts`. If an upgrade can fail only with existing data, add a fixture that represents the old schema and verifies the upgraded result.

Do not confuse indexer SQLite migrations with Soroban contract migrations. Contract upgrade behavior belongs in the smart-contract repository and its integration tests. The indexer migration workflow is `.github/workflows/indexer-migrations.yml`.

### Schema snapshots

The GraphQL schema tests normalize and snapshot both the monolithic schema and the modular schema. When intentionally changing GraphQL types, fields, arguments, nullability, or enum values:

1. Update the schema and its resolvers together.
2. Run the indexer snapshot tests.
3. Review the complete snapshot diff for accidental removals or nullability changes.
4. Update API consumers or integration tests when the change is breaking.

A snapshot update without a corresponding schema rationale should not be merged.

### Mutation testing

Mutation testing measures whether tests detect plausible defects. The current implemented target is the SDK error module using Stryker, configured in `packages/sdk/stryker.config.mjs`. The workflow is scheduled weekly, manually dispatchable, and runs on relevant SDK PRs; it is advisory and non-blocking.

When adding a new SDK mutation target, add focused behavioral tests first, then add the target to the Stryker configuration. Review surviving mutations and either strengthen the tests or document why a survivor is equivalent or intentionally unreachable. Rust `cargo-mutants` coverage remains a proposed future extension owned by `ILN-Smart-Contract`.

## Decision guide

### “I'm adding a new feature to X — what tests should I write, and where?”

1. **A pure helper, parser, formatter, validator, error mapper, or UI-independent module**
   - Add unit tests next to the implementation or in the workspace's established test directory.
   - Cover normal values, boundaries, invalid input, and error behavior.
   - Examples: CLI helpers in `cli/src/__tests__/`, SDK source tests in `packages/sdk/src/`, and notification service behavior in `notifications/tests/`.

2. **A CLI command or configuration option**
   - Add unit tests for parsing, validation, output, and failure paths.
   - Add or update `cli/tests/config-schema-drift.test.ts` when `config.schema.json` or `ConfigSchema` changes.
   - Add an integration test in `cli/tests/` when the command crosses the client, filesystem, signer, or local RPC boundary.

3. **An SDK method or public type**
   - Add unit tests for serialization, validation, errors, and backwards-compatible behavior.
   - Add an SDK integration test when the method calls RPC or a contract fixture.
   - Add or update E2E coverage when the public method is part of a complete local-node or application workflow.
   - Consider a mutation target for high-risk, self-contained logic with a fast, focused test suite.

4. **A smart-contract instruction, validation, or state transition**
   - Add Rust contract unit tests in `ILN-Smart-Contract` for authorization, state transitions, invalid inputs, and boundary values.
   - Add integration or E2E coverage when the behavior depends on token contracts, multiple actors, events, or SDK/CLI encoding.
   - Update generated interfaces and their consumers when the contract interface changes.

5. **Indexer ingestion, query, GraphQL, or persistence behavior**
   - Add unit tests for transformation and query logic.
   - Add integration tests with an in-memory database or controlled event fixture.
   - Update `indexer/tests/migrations.test.ts` for schema changes.
   - Update GraphQL schema snapshots for intentional schema changes and add resolver-level assertions for behavior not visible in the SDL.
   - Run a benchmark or load test when query cost, polling, ingestion throughput, or concurrency changes.

6. **Notifications, event processing, or delivery behavior**
   - Add unit tests for routing, templates, retries, idempotency, and failure handling in `notifications/tests/`.
   - Add integration coverage for the database, event source, email provider, webhook client, or queue boundary.
   - Run the notifications load test when changing delivery concurrency, retry policy, or event throughput.

7. **A frontend flow**
   - Add component/unit tests in `ILN-Frontend` for local state, rendering, validation, and accessibility.
   - Add browser E2E coverage for a user journey that crosses wallet, SDK, contract, or indexer boundaries.
   - Use local-node E2E for deterministic contract interaction and reserve shared-network or nightly tests for environment-dependent coverage.

8. **A migration, schema, or generated artifact**
   - Add a regression test that proves the old and new representations are handled as intended.
   - For indexer schemas, update migration tests; for GraphQL, update schema snapshots; for SDK or contract interfaces, run the relevant generation and compatibility checks.
   - Do not rely only on a regenerated file diff.

9. **A performance-sensitive change**
   - First add correctness tests.
   - Then run the relevant benchmark for a stable operation and a load test for concurrency or capacity behavior.
   - Include before/after context and environment details in the PR; do not turn machine-specific benchmark noise into arbitrary test thresholds.

10. **A documentation-only change**
    - Run formatting and documentation build/link checks as appropriate.
    - If the documentation changes a command, API, workflow, or test procedure, verify the referenced command and paths against the repository.

## Choosing the trigger

- **Every PR:** deterministic unit, integration, migration, schema-snapshot, type, lint, and build checks that can run within normal CI limits.
- **Nightly:** broad E2E matrices, cross-service workflows, and tests that need more setup or time but still represent routine product behavior.
- **Scheduled or manual:** load tests, benchmarks, mutation testing, testnet checks, and other resource-intensive or environment-dependent analysis.
- **Release/deployment:** migration rehearsal, production-like E2E, compatibility checks, and performance checks relevant to the release.

If a test is flaky, do not silently remove it from the PR suite. Follow [Flaky Test Quarantine](flaky-test-quarantine.md), identify the owner, and track the fix while preserving coverage where possible.

## Test reporting and review expectations

A PR should explain new or changed test coverage when the behavior is non-trivial. Reviewers should be able to answer:

- What behavior is protected?
- Why is this test at this layer rather than a lower or higher layer?
- Does it run on every PR, nightly, or on a schedule, and why?
- Are fixtures deterministic and isolated?
- If a snapshot, migration, benchmark, or mutation score changed, was the change intentional?

For more detail on local setup and existing test tooling, see [Local Development](local-development.md), [E2E Test Scope](e2e-test-scope.md), [SDK E2E](sdk-e2e.md), [Load Test Harness](load-test-harness.md), and [Mutation Testing](mutation-testing.md).
