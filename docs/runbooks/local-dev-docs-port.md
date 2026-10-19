# Local Development Documentation Port Runbook (#1285)

This operational specification defines the migration of the Local Development guide from legacy `docs/` to `packages/docs/content/local-development.mdx`.

## 1. Ported Surface
- Target: `packages/docs/content/local-development.mdx`
- Checked status in `docs/DOCS_SETUP.md`: `- [x] Local development guide`

## 2. Verification

```bash
pnpm test:local-dev-docs-port
```
