# @iln/eslint-config

Shared ESLint configuration for Invoice Liquidity Network monorepo.

## Installation

```bash
pnpm add -D @iln/eslint-config
```

## Usage

### Base Config (TypeScript)

```json
{
  "extends": ["@iln/eslint-config/base"]
}
```

### React Config (React + Hooks + A11y)

```json
{
  "extends": ["@iln/eslint-config/react"]
}
```

### Node Config (Node.js-specific)

```json
{
  "extends": ["@iln/eslint-config/node"]
}
```

## Configs

- **base**: Base configuration for TypeScript projects with ESLint recommended rules
- **react**: React-specific configuration (includes base + React + hooks + jsx-a11y rules)
- **node**: Node.js-specific configuration (includes base + Node.js-specific rules)

## Peer Dependencies

- `eslint` >= 8.0.0
- `@typescript-eslint/parser` >= 6.0.0
- `eslint-config-prettier` >= 9.0.0
