import { vi, beforeEach, afterEach } from 'vitest';

/**
 * Call this at the top of a test file (or in a global setup) to apply
 * standard ILN test environment defaults.
 *
 * - Resets all vitest mocks between tests
 * - Provides deterministic Date.now() seeding when a seed is passed
 */
export function setupILNTestEnvironment(
  options: {
    /** Freeze Date.now() to this unix-ms value for the test suite. */
    frozenTime?: number;
    /** Additional env vars to set before each test. */
    env?: Record<string, string>;
  } = {}
): void {
  beforeEach(() => {
    vi.resetAllMocks();

    if (options.frozenTime !== undefined) {
      vi.setSystemTime(options.frozenTime);
    }

    if (options.env) {
      for (const [key, val] of Object.entries(options.env)) {
        process.env[key] = val;
      }
    }
  });

  afterEach(() => {
    if (options.frozenTime !== undefined) {
      vi.useRealTimers();
    }
  });
}

/**
 * Minimal environment variables required to boot the notifications service
 * without a real Stellar node. Safe to call in a beforeEach.
 */
export function setNotificationsTestEnv(): void {
  process.env.NOTIFICATIONS_RPC_URL = 'http://localhost:8000';
  process.env.NOTIFICATIONS_CONTRACT_ID = 'GTESTCONTRACT';
  process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
  process.env.RESEND_API_KEY = 'test-api-key';
}
