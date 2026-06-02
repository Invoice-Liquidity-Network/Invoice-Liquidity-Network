#!/usr/bin/env node
// Minimal runtime wrapper: register ts-node then run the TS CLI
try {
  require('ts-node/register/transpile-only');
} catch (e) {
  // If ts-node isn't available, print a helpful message
  console.error('ts-node is required to run the ILN CLI. Install dependencies with `pnpm install`.');
  process.exit(1);
}

require('../src/cli.ts');
