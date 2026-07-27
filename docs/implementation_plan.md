# Implementation Plan - Unit Tests for check-compatibility.ts (Issue #787)

## Goal Description
`scripts/check-compatibility.ts` validates version compatibility across contract, SDK, and frontend components in CI. To ensure this critical script remains reliable and catches version mismatches, this plan exports its core parsing functions and adds a complete unit test suite in `scripts/__tests__/check-compatibility.test.js`.

## Proposed Changes

### Scripts & Tooling

#### [MODIFY] [check-compatibility.ts](file:///C:/Users/%D0%9C%D0%B0%D0%BA%D1%81%D0%B8%D0%BC/Documents/antigravity/valiant-hopper/iln-repo/scripts/check-compatibility.ts)
- Export `readContractVersion`, `readJsonVersion`, `parseCompatibilityMatrix`, and `validateCompatibility`.
- Allow optional custom root/doc parameters for deterministic fixture testing.
- Guard main execution block so importing the module does not trigger process exit during tests.

#### [NEW] [check-compatibility.test.js](file:///C:/Users/%D0%9C%D0%B0%D0%BA%D1%81%D0%B8%D0%BC/Documents/antigravity/valiant-hopper/iln-repo/scripts/__tests__/check-compatibility.test.js)
- Test `readContractVersion` with valid Cargo.toml content and error path on missing version.
- Test `readJsonVersion` with valid package.json and error path on missing version field.
- Test `parseCompatibilityMatrix` with valid Markdown table, missing markers, and custom matrix rows.
- Test `validateCompatibility` for matching combinations and non-zero exit/error paths on mismatched versions.

## Verification Plan
- Run `node --test scripts/__tests__/check-compatibility.test.js` to ensure 100% passing tests.
