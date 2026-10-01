# RFC 0002 — Package Naming Convention

- **Status:** Draft
- **Author(s):** [@Wilfred007](https://github.com/Wilfred007)
- **Created:** 2026-07-19
- **PR:** (pending)

---

## Summary

Standardise all workspace package names under the `@iln/*` npm scope. Three
current conventions — `@iln/*`, `@invoice-liquidity/*`, and unscoped `iln-*`
names — will be consolidated into a single predictable pattern so that every
package can be imported as `@iln/<name>`.

---

## Motivation

The workspace currently mixes three naming conventions:

| Convention | Example | Count |
|---|---|---|
| `@iln/*` | `@iln/sdk` | 16 packages |
| `@invoice-liquidity/*` | `@invoice-liquidity/cli` | 3 packages |
| Unscoped / `iln-*` | `iln-indexer` | 8 packages |

This inconsistency creates real friction:

- Contributors cannot predict a package's import name from its directory.
- The root `package.json` already uses `@iln` for the `@iln/sdk` publish
  scope, but other packages contradict it.
- A future npm publishing strategy (publishing CLI, React bindings, etc.)
  needs a single registered scope.
- Dependency resolution is harder to reason about when names are split
  across three conventions.

---

## Detailed Design

### Naming rules

1. **All packages** use the `@iln/` scope.
2. **Package name** mirrors the directory name under `packages/` (or the
   top-level service directory). Use lowercase, no dots, hyphens allowed.
3. **Root package** keeps its current unscoped name (`invoice-liquidity-network`)
   because it is `private: true` and never published to npm.
4. **Example packages** keep unscoped names with an `iln-` prefix (e.g.
   `iln-react-example`) because they are reference code, not published.
5. **Legacy top-level directories** (`cli/`, `docs/`, `indexer/`, `notifications/`,
   `sdk/`) should be migrated into `packages/` in a separate follow-up; this
   RFC only renames the `name` field, not the directory layout.

### Name mapping

| # | Directory | Current name | Proposed name | Change? |
|---|---|---|---|---|
| 1 | `packages/sdk/` | `@iln/sdk-next` | `@iln/sdk` | yes |
| 2 | `packages/cli/` | `@iln/cli` | `@iln/cli` | no |
| 3 | `packages/indexer/` | `@iln/indexer` | `@iln/indexer` | no |
| 4 | `packages/react/` | `@iln/react` | `@iln/react` | no |
| 5 | `packages/shared/` | `@iln/shared` | `@iln/shared` | no |
| 6 | `packages/eslint-config/` | `@iln/eslint-config` | `@iln/eslint-config` | no |
| 7 | `packages/mock-backend/` | `@iln/mock-backend` | `@iln/mock-backend` | no |
| 8 | `packages/opentelemetry/` | `@iln/opentelemetry` | `@iln/opentelemetry` | no |
| 9 | `packages/scripts/` | `@iln/scripts` | `@iln/scripts` | no |
| 10 | `packages/test-utils/` | `@iln/test-utils` | `@iln/test-utils` | no |
| 11 | `packages/upgrade-tests/` | `@iln/upgrade-tests` | `@iln/upgrade-tests` | no |
| 12 | `packages/invoice-sdk/` | `@iln/invoice-sdk` | `@iln/invoice-sdk` | no |
| 13 | `packages/docs/` | `@invoice-liquidity/docs-next` | `@iln/docs` | yes |
| 14 | `docs/` | `@invoice-liquidity/docs` | `@iln/docs-legacy` | yes |
| 15 | `cli/` | `@invoice-liquidity/cli` | `@iln/cli-legacy` | yes |
| 16 | `indexer/` | `iln-indexer` | `@iln/indexer-service` | yes |
| 17 | `notifications/` | `iln-notifications` | `@iln/notifications` | yes |
| 18 | `sdk/` | `@iln/sdk` | `@iln/sdk-legacy` | yes |
| 19 | `tests/sdk-integration/` | `@iln/sdk-integration-tests` | `@iln/sdk-integration-tests` | no |

### Migration strategy

The rename is split into **10 follow-up issues** to avoid a single massive PR:

1. **Phase 1 — Non-breaking renames** (safe, no downstream consumers):
   `packages/docs`, `docs/`, `cli/`, `indexer/`, `notifications/`, `sdk/`

2. **Phase 2 — The `@iln/sdk-next` → `@iln/sdk` rename** requires careful
   coordination. A deprecation window of one release cycle is recommended:
   - Publish `@iln/sdk` v0.x under the new name while keeping `@iln/sdk-next`
     as an alias (re-export).
   - Update all internal imports.
   - Remove the `sdk-next` alias in a subsequent release.

3. **Each PR** updates exactly one `package.json` `name` field and all
   internal references (imports, `turbo.json` pipeline names, CI workflow
   workspace filters, `package.json` dependency specifiers).

4. **CONTRIBUTING.md** is updated with the naming convention (this RFC).

### Security considerations

- npm scope ownership: the `@iln` scope must be verified as registered and
  accessible to all maintainers before renames land.
- No secret or credential changes are required for name renames.

---

## Drawbacks

- Every rename is a **breaking change** for downstream consumers that import
  by package name. The phased approach limits blast radius, but anyone with
  a pinned `@invoice-liquidity/*` dependency will need to update.
- The `@iln/sdk-next` → `@iln/sdk` rename is the riskiest because `@iln/sdk`
  already exists at `sdk/`. The migration must retire the old `sdk/` package
  (renaming it to `@iln/sdk-legacy`) before the new `packages/sdk/` takes
  the `@iln/sdk` name.
- Some CI workflows and `turbo.json` pipeline names reference package names
  directly. Each rename requires updating those references.

---

## Alternatives

**Keep the three conventions as-is.** This is the cheapest option short-term
but compounds the problem as the workspace grows. Every new package forces a
choice between conventions with no guidance.

**Use `@invoice-liquidity/*` everywhere.** This scope is more descriptive but
longer to type, harder to grep, and already has fewer adopters (3 vs 16).
The cost of migrating the 16 existing `@iln/*` packages outweighs the
benefit of the longer name.

**Use a different scope entirely (e.g. `@iln-xyz/*`).** No precedent in the
workspace and no obvious advantage.

---

## Unresolved Questions

1. Should the root `invoice-liquidity-network` package also be scoped to
   `@iln/network` for consistency, or is the unscoped name acceptable since
   it is `private: true`?
2. What is the right deprecation window for `@iln/sdk-next` before the
   `@iln/sdk` name is fully transferred?
3. Should example packages (e.g. `iln-react-example`) also be moved to the
   `@iln/*` scope, or are they fine as unscoped reference code?
4. Who owns the `@iln` npm scope and can publish under it?
