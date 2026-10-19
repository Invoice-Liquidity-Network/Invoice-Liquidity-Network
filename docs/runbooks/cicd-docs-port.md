# CI/CD Documentation Port Runbook (#1286)

This operational specification defines the migration of the CI/CD pipeline reference from legacy `docs/` to `packages/docs/content/ci-cd.mdx`.

## 1. Ported Surface
- Target: `packages/docs/content/ci-cd.mdx`
- Checked status in `docs/DOCS_SETUP.md`: `- [x] CI/CD reference`

## 2. Verification

```bash
pnpm test:cicd-docs-port
```
