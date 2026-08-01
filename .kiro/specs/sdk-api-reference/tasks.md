# Implementation Plan: SDK API Reference Generation

## Overview

Implement an automated documentation pipeline that extracts JSDoc comments and TypeScript type information from `@iln/sdk` and publishes them as MDX pages inside the existing Nextra docs site. The pipeline consists of a TypeDoc configuration file, a TypeScript postprocessor script (`generate-docs.ts`), JSDoc annotations on all public SDK symbols, navigation wiring in the docs site, and a GitHub Actions CI workflow. All output is sandboxed to `packages/docs/content/sdk-reference/generated/`.

## Tasks

- [x] 1. Add TypeDoc devDependencies and npm scripts to `packages/sdk/package.json`
  - Add `"typedoc": "0.27.x"`, `"typedoc-plugin-markdown": "4.x"`, `"tsx": "^4.0.0"`, `"semver": "^7.6.0"`, and `"@types/semver": "^7.5.0"` to the `devDependencies` field
  - Add `"docs:generate": "tsx scripts/generate-docs.ts"` to the `scripts` field
  - Add `"docs:preview": "pnpm docs:generate && pnpm --filter @iln/docs dev"` to the `scripts` field
  - _Requirements: 1.6, 7.1_

- [x] 2. Create `packages/sdk/typedoc.json`
  - Write the static TypeDoc configuration JSON with `entryPoints: ["src/index.ts"]`, `entryPointStrategy: "resolve"`, `excludePrivate: true`, `excludeInternal: true`, `out: "../../packages/docs/content/sdk-reference/generated"`, `plugin: ["typedoc-plugin-markdown"]`, `fileExtension: ".mdx"`, `hideBreadcrumbs: true`, `parametersFormat: "table"`, `propertiesFormat: "table"`, `enumMembersFormat: "table"`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 3. Scaffold `packages/sdk/scripts/generate-docs.ts` with pure helper functions
  - Create the `packages/sdk/scripts/` directory and the script file
  - Implement and export `formatFooter(date: Date, version: string): string` — returns `Generated on YYYY-MM-DD from SDK v{semver}` using `date.toISOString().slice(0, 10)`
  - Implement and export `toMetaLabel(filename: string): string` — replaces hyphens with spaces and title-cases each word
  - Implement and export `isSandboxed(outputDir: string, filePath: string): boolean` — returns true iff `path.resolve(filePath)` starts with `path.resolve(outputDir)`
  - Implement and export `hasQualifyingDescription(reflection: DeclarationReflection): boolean` — returns true iff `reflection.comment?.summary` has at least one `{kind: "text"}` part containing a non-whitespace character
  - Implement and export `buildMetaObject(mdxFiles: string[]): Record<string, string>` — maps each filename-without-extension to its title-cased label via `toMetaLabel`
  - _Requirements: 2.2, 2.4, 2.5, 3.1, 3.2, 4.1_

- [x] 4. Implement the main orchestration logic in `packages/sdk/scripts/generate-docs.ts`
  - [x] 4.1 Implement Step 1: TypeScript version check
    - Resolve `typescript/package.json` from local `node_modules` and read its `version` field
    - If `semver.lt(detectedVersion, "4.6.0")` is true, print detected version and minimum `4.6.0` to stderr and exit 1
    - _Requirements: 7.3_

  - [x] 4.2 Implement Step 2–3: Read and validate `packages/sdk/package.json`
    - Read the file using the path resolved from `__dirname` (or `SDK_PACKAGE_JSON` env override)
    - On I/O error, print the expected path and error to stderr and exit 1
    - Call `semver.valid(pkg.version)`; if null, print the invalid value and expected semver format to stderr and exit 1
    - _Requirements: 3.3, 3.4_

  - [x] 4.3 Implement Step 4: Invoke TypeDoc programmatic API to build the reflection tree
    - Use `Application.bootstrap` with options parsed from `typedoc.json` to construct the reflection tree in memory without emitting files
    - _Requirements: 1.1, 2.1_

  - [x] 4.4 Implement Step 5: JSDoc coverage check
    - Traverse all `DeclarationReflection` nodes of kinds Class, Method, Function, TypeAlias, Interface, Enum, Property
    - Collect violations where `hasQualifyingDescription(reflection)` is false
    - If any violations exist, print each as `[MISSING JSDOC] SymbolName  path/to/file.ts:line` to stdout and exit 1 without writing any files
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 4.5 Implement Step 6: Sandbox path validation
    - Compute the resolved absolute path of every file TypeDoc would write
    - If any path does not start with the resolved absolute path of `packages/docs/content/sdk-reference/generated/`, print the conflicting path to stderr and exit 1
    - _Requirements: 2.4_

  - [x] 4.6 Implement Steps 7–8: Write MDX files and inject version footers
    - Trigger TypeDoc's renderer via `typedoc-plugin-markdown` to write the `.mdx` files to the output directory
    - For each written `.mdx` file, append `\n\n---\n\nGenerated on ${utcDate} from SDK v${semver}\n` using `formatFooter`
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2_

  - [x] 4.7 Implement Step 9: Generate `packages/docs/content/sdk-reference/generated/_meta.ts`
    - Scan the `generated/` output directory for all `*.mdx` files (excluding `_meta.ts`)
    - Build the meta object using `buildMetaObject` and write `generated/_meta.ts` with `export default { ... } satisfies Record<string, string>`
    - _Requirements: 2.5, 6.1, 6.2_

- [x] 5. Add JSDoc comments to all public SDK symbols in `packages/sdk/src/clients/InvoiceClient.ts`
  - Add a class-level `/** ... */` JSDoc block to `InvoiceClient` describing the client's role
  - Add JSDoc with `@param` and `@returns` to `constructor(serverUrl, contractId)`
  - Add JSDoc with `@param` and `@returns` (or `@returns {Promise<void>}`) to `submitInvoice(invoiceData)`
  - Add JSDoc with `@param` and `@returns` to `fundInvoice(invoiceId)`
  - Add JSDoc with `@param` and `@returns` to `markPaid(invoiceId)`
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Add JSDoc comments to all public SDK symbols in `packages/sdk/src/xdr.ts`
  - Add a `/** ... */` JSDoc block to the `ScVal` type alias
  - Add a module-level JSDoc block to the `xdr` const object
  - Add JSDoc with `@param` and `@returns` to `xdr.encode`
  - Add JSDoc with `@param` and `@returns` to `xdr.decode`
  - Add JSDoc with `@param` and `@returns` to `xdr.toReadable`
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 7. Checkpoint — Verify `docs:generate` exits 0 with full JSDoc coverage
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Write unit tests for pure helper functions in `packages/sdk/scripts/__tests__/generate-docs.test.ts`
  - [x] 8.1 Write unit tests for `formatFooter`
    - Verify output matches `Generated on YYYY-MM-DD from SDK v{semver}` exactly
    - Verify the date component is the UTC calendar date of the input `Date`
    - Test boundary dates (midnight UTC, end-of-month)
    - _Requirements: 3.1, 3.2_

  - [ ]* 8.2 Write unit tests for `toMetaLabel`
    - Verify `"type-aliases"` → `"Type Aliases"`, `"classes"` → `"Classes"`, single-word filenames
    - _Requirements: 2.5_

  - [ ]* 8.3 Write unit tests for `isSandboxed`
    - Verify paths inside the sandbox return true
    - Verify `../`, `%2F`, and other path traversal sequences return false
    - _Requirements: 2.4_

  - [ ]* 8.4 Write unit tests for `hasQualifyingDescription`
    - Verify that `null`, empty summary, and whitespace-only comments return false
    - Verify that at least one non-whitespace character in a text part returns true
    - _Requirements: 4.1_

  - [ ]* 8.5 Write unit tests for `buildMetaObject`
    - Verify that the output keys equal input filenames without extensions
    - Verify that every value is the title-cased label produced by `toMetaLabel`
    - _Requirements: 2.5_

- [ ] 9. Write property-based tests using fast-check in `packages/sdk/scripts/__tests__/generate-docs.test.ts`
  - [ ]* 9.1 Write PBT for Property 1: Category-to-file bijection
    - Generate arbitrary subsets of the five TypeDoc categories (classes, interfaces, enumerations, type-aliases, functions), each with ≥ 1 symbol
    - Assert `Object.keys(generatedFiles).sort()` equals `nonEmptyCategories.sort()`
    - Minimum 100 iterations
    - **Property 1: Category-to-file bijection**
    - **Validates: Requirements 2.1, 6.2**

  - [ ]* 9.2 Write PBT for Property 2: All generated files are valid MDX 2
    - Generate arbitrary symbol names, JSDoc strings (including strings with `<`, `>`, `{`, `}`, backticks), and TypeScript type signatures
    - Assert `compile(mdxContent)` from `@mdx-js/mdx` does not throw for any generated content
    - Minimum 100 iterations
    - **Property 2: All generated files are valid MDX 2**
    - **Validates: Requirements 2.2**

  - [ ]* 9.3 Write PBT for Property 3: Output path sandboxing
    - Generate arbitrary strings via `fc.string()` including path separator characters as potential symbol names
    - Assert `isSandboxed(outputDir, path.join(outputDir, name))` is true for well-formed names
    - Assert `isSandboxed(outputDir, path.resolve(outputDir, '../outside'))` is false (traversal detection)
    - Minimum 100 iterations
    - **Property 3: Output path sandboxing**
    - **Validates: Requirements 2.4**

  - [ ]* 9.4 Write PBT for Property 4: `_meta.ts` completeness and key correspondence
    - Generate arbitrary lists of `.mdx` filenames via `fc.array(fc.string())`
    - Assert `Object.keys(buildMetaObject(files))` equals `files.map(f => path.basename(f, '.mdx'))` (same set, no extras, no missing)
    - Assert every value in the result is a non-empty string
    - Minimum 100 iterations
    - **Property 4: _meta.ts completeness and key correspondence**
    - **Validates: Requirements 2.5, 6.2**

  - [ ]* 9.5 Write PBT for Property 5: Version footer format and placement
    - Generate arbitrary `fc.date()` values and valid semver strings via `fc.semVer()`
    - Assert `formatFooter(date, version)` matches `/^Generated on \d{4}-\d{2}-\d{2} from SDK v.+$/`
    - Assert the date portion equals `date.toISOString().slice(0, 10)`
    - Minimum 100 iterations
    - **Property 5: Version footer format and placement**
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 9.6 Write PBT for Property 6: Invalid semver terminates generation
    - Generate arbitrary strings and filter to those where `semver.valid(s) === null`
    - Assert that the version validation step called with those strings returns a non-zero exit result
    - Assert the error message includes the invalid value
    - Minimum 100 iterations
    - **Property 6: Invalid semver terminates generation**
    - **Validates: Requirements 3.4**

  - [ ]* 9.7 Write PBT for Property 7: JSDoc coverage enforcement with pre-write abort
    - Build a mock `DeclarationReflection` tree with an arbitrary mix of documented and undocumented symbols, ensuring at least one symbol always lacks a qualifying description
    - Assert exit code is non-zero
    - Assert the output contains every missing symbol name (not just the first)
    - Assert the `generated/` directory remains unchanged (zero files written)
    - Minimum 100 iterations
    - **Property 7: JSDoc coverage enforcement with pre-write abort**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [ ]* 9.8 Write PBT for Property 8: TypeScript version gate
    - Generate semver strings via `fc.semVer()` filtered by `semver.lt(v, "4.6.0")`
    - Assert exit code is non-zero for all such versions
    - Assert stderr contains both the generated version string and `"4.6.0"`
    - Minimum 100 iterations
    - **Property 8: TypeScript version gate**
    - **Validates: Requirements 7.3**

  - [ ]* 9.9 Write PBT for Property 9: Internal anchor link resolution
    - Generate a mock set of MDX files with arbitrary `[text](./other-page)` links where the target file name is drawn from the generated set
    - Assert every link target resolves to an existing file within the `generated/` set
    - Also assert that a link to a non-existent file is detected as a dangling reference
    - Minimum 100 iterations
    - **Property 9: Internal anchor link resolution**
    - **Validates: Requirements 6.4**

- [x] 10. Update `packages/docs/content/sdk-reference/_meta.ts` to import and spread `generated/_meta`
  - Add `import generatedMeta from './generated/_meta'` at the top of the file
  - Spread `...generatedMeta` after the existing hand-authored keys (`installation`, `api-reference`, `error-handling`) so hand-authored entries appear first
  - _Requirements: 6.3, 6.5_

- [x] 11. Checkpoint — Verify docs build succeeds end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Create `.github/workflows/sdk-api-docs.yml` — CI workflow
  - [x] 12.1 Create the workflow file with `on: push/pull_request` path filter `packages/sdk/src/**`
    - Set `permissions: contents: write, pull-requests: write`
    - Declare `pnpm-cache` job reusing `.github/workflows/reusable-cache-pnpm.yml`
    - _Requirements: 5.1_

  - [x] 12.2 Implement `sdk-api-docs` job with `needs: [pnpm-cache]`
    - Use `actions/checkout@v4` with `fetch-depth: 0`
    - Use `./.github/actions/setup-pnpm` composite action
    - Add `id: generate` step: `run: pnpm --filter @iln/sdk docs:generate`
    - _Requirements: 5.2, 5.5_

  - [x] 12.3 Add the bot commit-and-push step
    - Condition: `if: success() && github.event_name != 'pull_request'`
    - Configure `github-actions[bot]` identity, `git add packages/docs/content/sdk-reference/generated/`, commit with message `chore(docs): regenerate SDK API reference [skip ci]`, and push
    - _Requirements: 5.3_

  - [x] 12.4 Add PR comment step for coverage failures and job-summary fallback
    - Condition for PR comment: `if: failure() && github.event_name == 'pull_request'` using `actions/github-script@v7` to post the undocumented symbol list
    - Condition for job summary: `if: failure() && github.event_name != 'pull_request'` writing to `$GITHUB_STEP_SUMMARY`
    - _Requirements: 5.4_

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP, but property-based tests are strongly recommended before merging
- The design uses TypeScript throughout; all scripts use `tsx` for execution
- Task 3 (helper functions) must be complete before any PBT tasks (9.x) since the tests import and exercise those helpers directly
- JSDoc tasks (5 and 6) must be complete before running `docs:generate` end-to-end; the script exits 1 until every public symbol is documented
- The `generated/_meta.ts` import in task 10 will cause a Next.js build failure until task 4.7 has run at least once and produced the generated file — this is intentional per Requirement 6.5
- Tasks 12.1–12.4 can be implemented sequentially in a single workflow file; they are split for dependency-graph clarity
- fast-check must be installed as a devDependency in `packages/sdk` before PBT tasks can run

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["3.1", "4.1", "4.2", "5.1", "6.1"] },
    { "id": 2, "tasks": ["4.3", "4.4", "4.5"] },
    { "id": 3, "tasks": ["4.6", "8.1", "8.2", "8.3", "8.4"] },
    { "id": 4, "tasks": ["4.7", "8.5", "9.5", "9.6", "9.8"] },
    { "id": 5, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.7", "9.9", "10.1"] },
    { "id": 6, "tasks": ["12.1"] },
    { "id": 7, "tasks": ["12.2"] },
    { "id": 8, "tasks": ["12.3", "12.4"] }
  ]
}
```
