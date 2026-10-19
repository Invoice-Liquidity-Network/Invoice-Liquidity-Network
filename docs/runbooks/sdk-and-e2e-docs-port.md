# SDK & E2E Documentation Port Runbook (#1290)

This operational specification governs the migration of SDK migration guides, E2E testing docs, and trust models from legacy `docs/` to `packages/docs/content/`.

## 1. Ported Pages
- `packages/docs/content/sdk-migration-guide.mdx`
- `packages/docs/content/sdk-e2e.mdx`
- `packages/docs/content/sdk-trust-model.mdx`
- `packages/docs/content/sdk-next-migration.mdx`

## 2. Invariants
- Checked status in `docs/DOCS_SETUP.md`: all 4 items marked `- [x]`.
- All SDK imports use canonical `@iln/sdk` and `@iln/sdk-next` namespaces.

## 3. Verification

```bash
pnpm test:sdk-docs-port
```
