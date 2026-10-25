# Runbook: Local Development Guide Check (Issue #1285)

The [Local Development guide](../local-development.md) is the path every new
contributor follows. This control fails CI when the guide stops matching the
repository, and when the local-dev entry points it documents are broken.

| | |
|---|---|
| **What** | `scripts/check-local-dev-docs.mjs` (logic in `scripts/lib/local-dev-docs.mjs`, tests in `scripts/__tests__/local-dev-docs.test.mjs`) |
| **Runs** | Every PR and push to `main`/`dev` that touches the guide, root/package manifests, `docker-compose.yml`, `Makefile`, the setup/deploy/seed scripts, `.env.example` files or service sources, and weekly — [Local Dev Docs workflow](../../.github/workflows/local-dev-docs.yml) |
| **Entry-point job** | `docker compose config --quiet`, `bash -n` on every setup/deploy/seed script, `make -n` on every target, and `pnpm oracle:test` through the root wrapper |
| **Owner** | `@Invoice-Liquidity-Network/devops` (guide content: `@Invoice-Liquidity-Network/docs-lead`) |
| **Proof it is active** | `local-dev-docs-report` artifact (JSON) and the job summary on every run |

## What it enforces

| Rule | Fails when |
|---|---|
| `root-script-npm-workspace` | A root script calls `npm run … -w`/`--workspace`; npm workspaces are not declared, so npm exits with `No workspaces found` |
| `pnpm-workspace-root-flag` | A command uses `pnpm <script> -w <pkg>`; `-w` is `--workspace-root`, so the root script runs and the package name is passed to it |
| `filter-unknown-package` / `filter-unknown-script` | A `pnpm --filter <pkg> <script>` in the guide, a root script or a compose command names a package or script that does not exist |
| `root-script-missing` | The guide runs `pnpm <script>` and the root `package.json` has no such script |
| `make-target-missing` / `make-cd-missing` | The guide runs a `make` target that does not exist, or a Makefile recipe `cd`s into a directory that is neither in the tree nor a submodule |
| `wasm-target-not-installed` / `dev-setup-target-drift` | The Makefile or deployer uses a `target/<wasm-triple>/` that `scripts/dev-setup.sh` never installs, or the guide misstates which targets it installs |
| `path-missing` / `link-missing` | A repository path or relative link in the guide does not exist (build outputs listed in `GENERATED_PATHS` are exempt) |
| `prerequisite-drift` | The Node.js or pnpm version differs from the root `engines` |
| `workspace-undocumented` / `example-undocumented` / `package-name-drift` | A `pnpm-workspace.yaml` entry or `examples/*` app is missing from the guide, or a catalog row's package name is wrong |
| `env-example-missing` / `env-example-claim` | A `cp <x>.env.example` source does not exist, or the guide says a service has no `.env.example` when it does |
| `env-var-unread` | A variable in a service's table is not read by that service's (non-test) source |
| `env-default-drift` | A documented literal default differs from the one the source falls back to |
| `env-example-undocumented` / `env-example-unread` | A key in `<service>/.env.example` is missing from the guide's table, or no source reads it |
| `compose-service-drift` / `compose-port-drift` / `compose-command-drift` / `compose-count-drift` | The Docker Compose table, port lists, documented commands or service counts (in the guide or the compose header comment) differ from `docker-compose.yml` |
| `docker-output-unwritten` | A documented `.docker-output/*` file is written by neither the deployer nor the seeder |
| `doc-unreadable` / `repo-unreadable` / `compose-unreadable` / `env-section-missing` / `compose-table-missing` | An input cannot be read or a required section is missing — the check fails closed, it never skips |

Baseline when introduced (#1285): **33 findings** on `dev` @ `15f704a`:

- 10 root scripts (`oracle:*`, `docs:*`, `react:*`) failing with `No workspaces found`;
- the compose `indexer` and the guide running `pnpm dev -w iln-indexer`;
- three Makefile targets `cd`-ing into a nonexistent `invoice-liquidity-network/`;
- five uses of `wasm32v1-none`, a target that `dev-setup.sh` never installed;
- `tests/sdk-integration` not documented;
- ten `.env.example` keys missing from the guide;
- a compose header claiming three services.

After the fix: **0**.

## Run it

```bash
node scripts/check-local-dev-docs.mjs
node scripts/check-local-dev-docs.mjs --json=local-dev-docs-report.json
node --test scripts/__tests__/local-dev-docs.test.mjs
```

## Recovery

Each finding prints `[rule] file:line message`. Decide which side is wrong:

- **The repository is right** (a script was renamed, a variable or default
  changed, a compose service moved): update `docs/local-development.md` and its
  canonical copy `packages/docs/content/local-development.mdx` in the same PR.
- **The entry point is wrong** (`root-script-npm-workspace`,
  `pnpm-workspace-root-flag`, `make-cd-missing`, `wasm-target-not-installed`):
  fix the script, compose file, Makefile or `scripts/dev-setup.sh`. Never change
  the guide to describe a command that fails.
- **A new `.env.example` key**: document it in the service's table with its
  default, or remove it from the example if nothing reads it.
- **A new build-output path** the guide must mention: add it to
  `GENERATED_PATHS` in `scripts/lib/local-dev-docs.mjs` with a test.

Escalate to `@Invoice-Liquidity-Network/devops` when a finding is in the
entry-point job (compose, shell syntax, Make, or the `pnpm oracle:test` smoke),
because those break every contributor's setup.

## Not covered

The check reads files; it does not start Docker or a Stellar node. The
fresh-machine walkthrough in the guide (macOS, Ubuntu, Windows WSL) is still
recorded by hand in the [validation log](../local-development-validation.md).
