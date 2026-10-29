# Local development guide validation log

## Walkthrough 1 — existing development workstation

This is a local walkthrough, **not** the clean-environment/fresh-contributor
validation required before marking the guide fully verified.

Environment: Ubuntu container, Node.js `v22.23.2`, Docker `29.1.3`, Compose
`2.40.3`, Rust/Cargo `1.97.1`, Stellar CLI `27.1.0`. The frontend and backend
submodules were present at the checked-out revisions.

| Time (Africa/Lagos) | Step | Blocker or result | Resolution |
| --- | --- | --- | --- |
| 2026-10-15 18:34 | `pnpm --version` from the repository root | pnpm reported `Invalid package.json in package.json`; JSON parsing found a missing comma after the `test:canary` script entry. | Added the missing comma in `package.json`. Re-run the package-manager and installation steps before considering this finding closed. |
| 2026-10-15 18:39 | Retry `pnpm --version` after the JSON fix | Corepack attempted to fetch pinned pnpm `9.0.0`, but the package registry timed out (`ETIMEDOUT`/`ENETUNREACH`). | No repository change. Retry when registry access is available; dependency installation and Docker stack verification remain untested. |
| 2026-10-15 18:54 | CI workspace package validation | `tests/sdk-integration/package.json` advertised a nonexistent `dist/index.js` entry point and omitted the repository-required Node engine and license metadata. | Removed the invalid `main` field and added `engines.node: >=20` and `license: MIT`. |
| 2026-10-15 18:55 | CI monorepo-map drift check | The workspace map omitted the existing `oracle-service/` and `tests/sdk-integration/` workspaces; the checker also hard-coded root workspace names. | Documented both workspaces and changed the checker to accept any inline-code workspace path from the map. |
| 2026-10-15 18:55 | CI documentation link check | Markdown links shown inside fenced guide examples were interpreted as links from `DEPLOYMENT_GUIDE.md`, producing false missing-file errors. | Updated the checker to ignore fenced Markdown examples and added a regression test. An external docs-site fetch failure remains network-dependent. |
| 2026-10-15 19:00 | CI external documentation checks | The runner could not fetch `https://docs.iln.finance`, so the checker treated an unavailable network as a broken destination. | Network errors now produce a warning; HTTP error responses still fail the check. Added coverage for both cases. |
| 2026-10-15 18:35 | `stellar --version` | The installed CLI reports `27.1.0`; the guide only says “Current stable,” so a contributor cannot tell whether their version is supported or known to work. | No version pin or supported-version range established in this walkthrough. Follow-up: document the tested CLI version/range after clean-machine validation. |
| 2026-10-15 18:35 | Fresh-checkout requirement | This checkout already had initialized submodules and pre-existing tool configuration, so it cannot demonstrate the clone, install, and setup steps from a genuinely clean contributor environment. | Requires a separate contributor/container with no pre-existing checkout state. |

## Walkthrough 2 — fresh clone in a clean container (#1285)

A fresh `git clone` of branch `wave-9/1285-close-unchecked-local-development-documentation-work`
(commit `8e1dfe1`, based on `dev` @ `15f704a`) in an Ubuntu cloud container with
no prior checkout, `node_modules` or pnpm store for it. Node.js `v22.22.0`,
pnpm `9.0.0` (Corepack), Docker CLI `29.8.2` with Compose `v5.5.1` but **no
Docker daemon**, and no Rust or Stellar CLI. Submodules were not initialized
(`git submodule status` shows `-` for `frontend` and `backend`), as the guide
describes for a plain clone. Times are UTC; `~` marks steps timed from the session rather than a log file.

| Time (UTC) | Step | Blocker or result | Resolution |
| --- | --- | --- | --- |
| 2026-10-20 15:18 | `npm run typecheck -w @iln/oracle-service`, the form every `oracle:*` wrapper used on `dev` | `npm error No workspaces found: --workspace=@iln/oracle-service`. The same failure affects all ten `oracle:*`, `docs:*` and `react:*` wrappers, and therefore the compose `oracle-service` container (`pnpm oracle:dev`). | Fixed in #1285: the wrappers use `pnpm --filter <pkg> run <script>`. The check flags any `npm … -w` root script. |
| 2026-10-20 ~15:20 | Read `docker-compose.yml` `indexer` command | `pnpm dev -w iln-indexer` runs the root `turbo run dev` (`-w` is `--workspace-root`), not the indexer. The container also used the testnet contract and passphrase against the local node. | Fixed in #1285: `pnpm --filter iln-indexer dev`, `CONTRACT_ID` from `.docker-output/contract-id.txt`, standalone passphrase, waits for `contract-deployer`. |
| 2026-10-20 ~15:21 | Read the `Makefile` and `make -n build deploy-local test` | Every recipe ran `cd invoice-liquidity-network`, a directory that does not exist; `dev-setup.sh` installed only `wasm32-unknown-unknown` while `make deploy-local` deploys from `target/wasm32v1-none/`. | Fixed in #1285: recipes use `backend/`; `dev-setup.sh` installs `wasm32v1-none` too. |
| 2026-10-20 15:31 | `pnpm install --frozen-lockfile` | Passed (10.4 s). | — |
| 2026-10-20 15:31 | `pnpm validate:lockfiles` | Passed: no foreign lockfiles. | — |
| 2026-10-20 15:31–15:33 | `pnpm build` (and `--continue`) | **Fails on `dev` code, not on setup:** 10 of 18 build tasks fail — `iln-indexer` (`src/api.ts` parse error), `iln-notifications` (`src/api.ts`, `rate-limiter.test.ts` parse errors), `@iln/oracle-service` (TypeScript errors in `cache.ts`/`index.ts`), docs sites, `@iln/react` and four examples (`Cannot find module '@iln/sdk'` — they depend on `file:../../sdk`). `@iln/sdk`, the CLI, `@iln/shared`, `@iln/indexer`, `@iln/mock-backend`, `@iln/opentelemetry`, `@iln/sdk-next` and `@iln/upgrade-tests` build. | Open: tracked separately from the guide. Per-package commands in the guide work for the packages that build. |
| 2026-10-20 15:34 | `pnpm oracle:test` (after the fix) | Passed: 48 test files, 970 tests (the compiled `dist/` copies included). | — |
| 2026-10-20 15:34 | `pnpm docs:cli` / `pnpm docs:api` | `docs:cli` regenerated `cli-reference.mdx`. `docs:api` now reaches TypeDoc, which fails on type errors in `sdk/src/backoff.test.ts`. | `docs:api` open, an SDK issue; before the fix it never reached the SDK. |
| 2026-10-20 15:34 | `docker compose config --quiet`, `make -n …`, `node scripts/check-local-dev-docs.mjs` | All pass. | — |
| 2026-10-20 15:34 | `docker compose up --build` | Not run: no Docker daemon in the container, and the `backend/` contract was not built (no Rust/Stellar CLI). | Still requires a machine with Docker and Rust — see below. |

## Remaining validation

Walkthrough 2 covered a clean clone, install and the Node-side commands, but not
Docker, Rust or the Stellar CLI. The fresh-machine pass with the Docker stack has
not been performed. The remaining checklist
in [local-development.md](local-development.md#fresh-machine-verification-checklist)
must stay pending until a contributor follows the guide on a clean macOS, Ubuntu,
or Windows WSL environment, records each blocker with its timestamp, and repeats
the walkthrough after fixes.
