import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPRESS_DEPRECATION_ENV } from './deprecation';

const CODE = 'ILN_SDK_DEPRECATED_LEGACY_IMPORT';

function warnedCodes(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map((call: unknown[]) => (call[1] as { code?: string } | undefined)?.code)
    .filter((code: string | undefined): code is string => code === CODE);
}

describe('@iln/sdk/legacy migration warning (#1222)', () => {
  let emitWarning: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    delete process.env[SUPPRESS_DEPRECATION_ENV];
    emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env[SUPPRESS_DEPRECATION_ENV];
    vi.restoreAllMocks();
  });

  it('warns when the legacy entry point is imported, and still exports the canonical API', async () => {
    const legacy = await import('./legacy-imports');
    expect(warnedCodes(emitWarning)).toEqual([CODE]);
    // Compatibility is preserved: the shim must keep working while it warns.
    expect(typeof legacy.ILNSdk).toBe('function');
    expect(legacy.ILN_TESTNET).toBeDefined();
    expect(legacy.SDK_VERSION).toBeDefined();
  });

  it('warns once per process even if the entry point is imported repeatedly', async () => {
    await import('./legacy-imports');
    await import('./legacy-imports');
    expect(warnedCodes(emitWarning)).toHaveLength(1);
  });

  it('warns again after a restart (fresh module registry)', async () => {
    await import('./legacy-imports');
    vi.resetModules();
    await import('./legacy-imports');
    expect(warnedCodes(emitWarning)).toHaveLength(2);
  });

  it('can be silenced explicitly, and the shim still loads', async () => {
    process.env[SUPPRESS_DEPRECATION_ENV] = '1';
    const legacy = await import('./legacy-imports');
    expect(warnedCodes(emitWarning)).toEqual([]);
    expect(typeof legacy.ILNSdk).toBe('function');
  });

  it('does not warn when the canonical entry point is imported', async () => {
    await import('./index');
    expect(warnedCodes(emitWarning)).toEqual([]);
  });

  it('a failing warning sink cannot break the import', async () => {
    emitWarning.mockImplementation(() => {
      throw new Error('stderr closed');
    });
    const legacy = await import('./legacy-imports');
    expect(typeof legacy.ILNSdk).toBe('function');
  });
});
