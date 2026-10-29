/**
 * Vitest configuration for E2E tests.
 *
 * Issues #1249–#1252 — E2E hardening: multi-token, governance, lifecycle-fresh,
 * and contract isolation.
 *
 * Runs every test in tests/e2e/ (including lifecycle-fresh.test.ts) in Node
 * environment with a generous per-test timeout, since each test may contact a
 * live local Stellar node via Docker.
 *
 * Run:  pnpm test:e2e  (or npm run test:e2e)
 *
 * Environment variables:
 *   E2E_RPC_URL          Override the Soroban RPC URL (default: http://localhost:8000/soroban/rpc)
 *   E2E_FRIENDBOT_URL    Override the Friendbot URL  (default: http://localhost:8000/friendbot)
 *   E2E_NETWORK_PASSPHRASE  Override the network passphrase (default: Standalone Network ; February 2017)
 *   E2E_ILN_CONTRACT_ID  Real deployed ILN contract ID (required for on-chain tests)
 *   E2E_USDC_CONTRACT_ID Real deployed USDC SAC contract ID
 *   E2E_EURC_CONTRACT_ID Real deployed EURC SAC contract ID
 *   E2E_XLM_CONTRACT_ID  Real deployed XLM SAC contract ID
 *   E2E_ALLOW_SKIP       Set to "1" only for local runs without a live node (forbidden on CI)
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Pick up every E2E test file, including lifecycle-fresh.test.ts.
    include: ['tests/e2e/**/*.test.ts'],
    // E2E tests talk to a real (local) Stellar node — allow up to 60 s per test.
    testTimeout: 60_000,
    // Do not parallelise across workers: each test uses Friendbot which has
    // rate-limit behaviour on the quickstart container, and the contract has
    // shared on-chain state that tests must not race over.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Print each test name so CI logs are easy to scan.
    reporter: ['verbose'],
  },
});
