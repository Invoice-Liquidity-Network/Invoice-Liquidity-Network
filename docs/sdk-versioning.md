# SDK Versioning and Support Windows

This page is the policy of record for how the Invoice Liquidity Network
versions its SDK surfaces and records their intended support windows. The
machine-readable manifest, [`sdk-support-windows.json`](sdk-support-windows.json),
is checked by CI (`scripts/check-sdk-support-windows.mjs`) against workspace
`package.json` versions and this page. This is a repository consistency check;
it does not query npm or verify which versions are currently published.

**Owner:** @iln/sdk, @iln/sdk-next and @iln/react maintainers
**Runbook:** [runbooks/sdk-support-windows.md](runbooks/sdk-support-windows.md)

## Surfaces

| Package | Directory | Channel | Version | Introduced | Support ends |
|---|---|---|---|---|---|
| `@iln/sdk` | `sdk/` | stable | `0.1.0` | 2025-06-01 | until 1.0 + 90-day notice |
| `@iln/sdk-next` | `packages/sdk/` | experimental | `0.1.0` | 2025-06-01 | 2026-12-31 |
| `@iln/react` | `packages/react/` | stable | `0.1.0` | 2025-06-01 | until 1.0 + 90-day notice |

## Versioning model

All surfaces are pre-1.0 and use [Semantic Versioning](https://semver.org/).
While a package is `0.y.z`:

- **Patch** (`0.1.x`) — backwards-compatible bug fixes. Always supported.
- **Minor** (`0.x.0`) — may contain breaking changes; call them out in
  [`CHANGELOG.md`](../CHANGELOG.md) and the [SDK Migration Guide](sdk-migration-guide.md).
- **Major** (`1.0.0`) — the stability commitment. After 1.0, breaking changes
  require a major bump and the support model below applies in full.

The `stable` channel is the production SDK (`@iln/sdk`) and the React hooks
(`@iln/react`). The `experimental` channel (`@iln/sdk-next`) may break at any
minor release and has a fixed end-of-life date rather than an indefinite
window.

## Support windows

The policy target for stable surfaces is **current minor plus the previous
minor**:

1. The current minor of every `stable` surface receives bug fixes and security
   patches.
2. The previous minor is intended to receive security patches during the
   `deprecationNoticeDays` (90) notice period after the next minor is released.
3. When a version reaches its `eol` date it is **end-of-life**: no further
   patches, and consumers must upgrade. End-of-life is inclusive of the `eol`
   date — the version is still supported on its final day.

`eol: null` means no absolute EOL date has been recorded. The stable package
manifests currently declare version `0.1.0`; `@iln/sdk-next` has the recorded
absolute EOL date `2026-12-31`. A non-null `eol` is an absolute date. The
90-day notice is the stated policy; the checker validates date/status shape
and active-window expiry, but does not calculate that the date is 90 days
after a release or prove that prior minors receive patches.

### What has been verified

- The manifest versions match the three workspace package versions, and all
  three package manifests set `engines.node` to `>=20`.
- `@iln/react` declares peers `@iln/sdk@^0.1.0`, `react@^19.0.0`, and
  `@tanstack/react-query@^5.62.0`. The stable SDK also declares optional React
  and React Native peers; `@iln/sdk-next` has no peer dependencies.
- `check:sdk-support-windows` verifies manifest coverage, package version
  agreement, valid dates/statuses, expired active windows, and that this page
  mentions each package and version. Its focused tests are
  `test:sdk-support-windows`.

Published registry state and consumer-resolvable version ranges are not
verified by that check. Check the release records/registry before making a
release decision. Whether to extend an EOL, change the 90-day policy, or ship
a breaking release remains a maintainer approval decision; no such decision
is implied by this audit.

## Compatibility guarantees

- Node.js: every surface requires `>=20` (`engines.node`).
- The React hooks keep `react@^19.0.0` and `@iln/sdk@^0.1.0` as peers; the full
  contract is enforced by `scripts/check-react-peer-contract.mjs` (see
  [runbooks/react-peer-contract.md](runbooks/react-peer-contract.md)).
- The export-map contract shared by every surface is documented in
  [runbooks/sdk-export-maps.md](runbooks/sdk-export-maps.md).

## Deprecation process

1. Announce the deprecation in [`CHANGELOG.md`](../CHANGELOG.md) and open a
   migration section in the [SDK Migration Guide](sdk-migration-guide.md).
2. Set `status` to `deprecated` in `sdk-support-windows.json` and set `eol` to
   a date at least `deprecationNoticeDays` in the future.
3. At `eol`, set `status` to `eol`. CI fails if an `active` surface's `eol` has
   passed, so the transition cannot be forgotten.

## Changing a support window

Support windows are declared per release in `sdk-support-windows.json`:

1. Bump the surface's `version` to match its `package.json`.
2. Update `status`, `introduced`/`eol` and the table above together.
3. Run `pnpm check:sdk-support-windows` and `pnpm test:sdk-support-windows`.

If the version and the manifest disagree, or the docs stop describing a
surface, CI blocks the change — see the runbook for recovery.
