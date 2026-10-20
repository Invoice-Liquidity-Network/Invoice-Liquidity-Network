# Clean Consumer Install Resolution Runbook (#1223)

This operational specification governs clean external consumer installation and package resolution outside the monorepo workspace.

## Invariant Checks

1. **Self-Contained Export Maps**: `@iln/sdk` and `@iln/react` publish valid `exports` pointing to compiled CJS, ESM, and TypeScript declaration bundles.
2. **Files Array Invariant**: `files: ["dist"]` must be declared to guarantee runtime assets are packaged by `pnpm pack` / `npm publish`.
3. **Peer Dependency Resolution**: `@iln/react` declares `@iln/sdk: "^0.1.0"` so clean consumer package managers install compatible singletons.

## Verification

```bash
pnpm test:consumer-install
```
