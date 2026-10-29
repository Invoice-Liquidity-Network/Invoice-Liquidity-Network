# Runbook: GitHub Actions Workflow Policy (Issue #1286)

The [CI/CD reference](../ci-cd.md) states two supply-chain controls for every
workflow — explicit least-privilege token permissions and SHA-pinned third-party
actions — and describes every workflow's triggers. This runbook covers the check
that keeps those statements true.

| | |
|---|---|
| **Control** | `scripts/check-workflow-policy.mjs` (`scripts/lib/workflow-policy.mjs`) plus `actionlint` |
| **Runs** | Every PR and push to `main`/`dev` that touches `.github/`, the CI/CD reference or the check, and weekly — [Workflow Policy workflow](../../.github/workflows/workflow-policy.yml) |
| **Owner** | `@Invoice-Liquidity-Network/devops` |
| **Proof it is active** | `workflow-policy-report` artifact (JSON report + actionlint output) and the job summary on every run |
| **Exemptions** | [`.github/workflow-policy.json`](../../.github/workflow-policy.json) — exact reference, release tag, reason |

## What it enforces

| Rule | Fails when |
|---|---|
| actionlint | A workflow has a syntax error, an unknown context, or an invalid expression — GitHub would refuse or mis-run it |
| `permissions-missing` | A workflow has no top-level `permissions:` block |
| `permissions-write-all` | A workflow grants `permissions: write-all` |
| `action-unpinned` | A third-party `uses:` (workflow or `.github/actions/*`) is not a 40-character commit SHA |
| `pin-without-version` | A pinned SHA has no `# <version>` comment |
| `exemption-invalid` | An exemption lacks an exact reference, a release tag (`vX.Y.Z`), or a reason |
| `exemption-stale` | An exemption matches no `uses:` in any workflow |
| `inventory-drift` | The generated workflow inventory in `docs/ci-cd.md` differs from the files |
| `pinned-table-drift` | The pinned-actions table misses an action or version in use, lists an unused one, or quotes a wrong SHA |
| `dead-workflow-reference` | `docs/ci-cd.md` names a `*.yml` workflow that does not exist |
| `port-drift` | `packages/docs/content/ci-cd.mdx` is missing or its inventory differs |
| `workflow-unreadable` | A workflow's top-level structure cannot be read — fails closed |

Baseline when introduced (#1286), on `dev`:

- **14 policy findings:** 3 workflows without `permissions:`, 7 unpinned
  third-party actions (one, `CycloneDX/gh-node-module-generatebom@1.4.0`, is a
  tag that never existed, so the SDK release's SBOM step could not resolve), 2
  references to a non-existent `scripts-release.yml`, no inventory, no port.
- **6 actionlint findings:** `docs-deploy.yml` and `synthetic-canary.yml` were
  invalid files GitHub would not run, and `coordinate-release.yml` and `e2e.yml`
  had expression errors (an unavailable `runner` context, and a step id
  `coverage` that did not exist, so the E2E evidence bundle always recorded the
  coverage gate as failed).

After: **0** of each.

## Run it

```bash
node scripts/check-workflow-policy.mjs                  # check
node scripts/check-workflow-policy.mjs --write          # regenerate the inventory (doc + site)
node --test scripts/__tests__/workflow-policy.test.mjs  # the guard's own tests
actionlint                                              # uses .github/actionlint.yaml
```

## Recovery

- **`permissions-missing`** — add a top-level block. Start from
  `permissions: { contents: read }` (or `permissions: {}` for a job that touches
  no repository contents) and grant extra scopes at the job that needs them.
- **`action-unpinned` / `pin-without-version`** — resolve the release tag to its
  commit and pin it with the version as a comment:
  `git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag> 'refs/tags/<tag>^{}'`
  (use the `^{}` line for an annotated tag), then
  `uses: <owner>/<repo>@<sha> # <tag>`. Renovate (`pinDigests: true`) keeps it
  current afterwards.
- **An action that cannot be pinned** (it verifies its own tag, like the SLSA
  generator) — add an exemption with the exact `owner/repo@vX.Y.Z`, the reason,
  and a link. Never exempt a branch.
- **`exemption-stale`** — delete the exemption; the action is no longer used.
- **`inventory-drift`** — run `node scripts/check-workflow-policy.mjs --write`
  and commit both `docs/ci-cd.md` and `packages/docs/content/ci-cd.mdx`. If the
  workflow change was not intended (a trigger or permission you did not mean to
  change), fix the workflow instead.
- **`pinned-table-drift` / `dead-workflow-reference`** — update the table or the
  prose in `docs/ci-cd.md`, then re-port it.
- **actionlint** — fix the reported line. A custom self-hosted runner label goes
  in `.github/actionlint.yaml`.

Never weaken the check, add a branch exemption, or widen a token scope to make
CI pass.

## Compatibility

Workflow behaviour changes in #1286, each to match what `docs/ci-cd.md` already
described or to make a broken workflow run:

- `docs-deploy.yml`: removed a step-less job that made the file invalid; added
  least-privilege permissions (`pages: write` + `id-token: write` only on the
  deploy job) and the `pages` concurrency group so two deployments never race.
- `cross-repo-sync.yml`, `indexer-migrations.yml`: `contents: read`. Cross-repo
  issue creation still uses `CROSS_REPO_SYNC_TOKEN`.
- `synthetic-canary.yml`: the live-probe job decides in its first step whether a
  target is configured (secrets cannot be read in a job-level `if:`).
- `coordinate-release.yml`: the release ledger path is set from `$RUNNER_TEMP`
  in a step.
- `e2e.yml`: the coverage gate step has `id: coverage`, which the evidence bundle
  reads.
- `sdk-release.yml`: SBOM step pinned to `CycloneDX/gh-node-module-generatebom`
  v1.0.3 without the unsupported `format` input (the `.json` output name selects
  JSON). Not exercised outside a tagged release.
- Pins for `pnpm/action-setup` use the same references already used across the
  repository (v4.4.0) or the exact commit `v3` resolves to today (v3.0.0).

No cross-repository change is required. Sibling repositories that call
`reusable-*.yml` are unaffected: those files are unchanged.
