import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEPRECATION_NOTICES,
  SUPPRESS_DEPRECATION_ENV,
  formatDeprecationMessage,
  getEmittedDeprecations,
  resetDeprecationWarnings,
  warnDeprecated,
} from './deprecation';

beforeEach(() => {
  resetDeprecationWarnings();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('warnDeprecated — success', () => {
  it('emits the legacy-import notice with replacement, removal version and docs', () => {
    const emit = vi.fn();
    expect(warnDeprecated('legacy-import', { emit, env: {} })).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
    const { notice, message } = emit.mock.calls[0][0];
    expect(notice.code).toBe('ILN_SDK_DEPRECATED_LEGACY_IMPORT');
    expect(message).toContain("'@iln/sdk/legacy'");
    expect(message).toContain("import from '@iln/sdk'");
    expect(message).toContain('1.0.0');
    expect(message).toContain('docs/sdk-migration-guide.md#deprecated-sdk-surface');
    expect(message).toContain(SUPPRESS_DEPRECATION_ENV);
  });

  it('defaults to a Node DeprecationWarning carrying the notice code', () => {
    const spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    expect(warnDeprecated('legacy-import', { env: {} })).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      formatDeprecationMessage(DEPRECATION_NOTICES['legacy-import']),
      { type: 'DeprecationWarning', code: 'ILN_SDK_DEPRECATED_LEGACY_IMPORT' }
    );
  });

  it('falls back to console.warn where process.emitWarning is unavailable', () => {
    const original = process.emitWarning;
    // @ts-expect-error simulate a host without process.emitWarning (browser / React Native)
    process.emitWarning = undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(warnDeprecated('legacy-import', { env: {} })).toBe(true);
    } finally {
      process.emitWarning = original;
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('ILN_SDK_DEPRECATED_LEGACY_IMPORT');
  });

  it('records what fired so an operator can prove the control ran', () => {
    expect(getEmittedDeprecations()).toEqual([]);
    warnDeprecated('legacy-import', { emit: vi.fn(), env: {} });
    expect(getEmittedDeprecations()).toEqual(['legacy-import']);
  });
});

describe('warnDeprecated — boundaries', () => {
  it('warns once per process, not once per call', () => {
    const emit = vi.fn();
    expect(warnDeprecated('legacy-import', { emit, env: {} })).toBe(true);
    expect(warnDeprecated('legacy-import', { emit, env: {} })).toBe(false);
    expect(warnDeprecated('legacy-import', { emit, env: {} })).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown notice ids instead of throwing', () => {
    const emit = vi.fn();
    expect(warnDeprecated('does-not-exist', { emit, env: {} })).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it.each(['1', 'true'])('is silenced by %s and records nothing', (value) => {
    const emit = vi.fn();
    expect(
      warnDeprecated('legacy-import', { emit, env: { [SUPPRESS_DEPRECATION_ENV]: value } })
    ).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    expect(getEmittedDeprecations()).toEqual([]);
  });

  it.each(['0', 'false', '', 'yes'])('is NOT silenced by %j', (value) => {
    const emit = vi.fn();
    expect(
      warnDeprecated('legacy-import', { emit, env: { [SUPPRESS_DEPRECATION_ENV]: value } })
    ).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('a suppressed call does not consume the once-only slot', () => {
    const emit = vi.fn();
    warnDeprecated('legacy-import', { emit, env: { [SUPPRESS_DEPRECATION_ENV]: '1' } });
    expect(warnDeprecated('legacy-import', { emit, env: {} })).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe('warnDeprecated — failure', () => {
  it('never throws when the sink throws, and does not retry into a warning storm', () => {
    const emit = vi.fn(() => {
      throw new Error('logger is down');
    });
    expect(() => warnDeprecated('legacy-import', { emit, env: {} })).not.toThrow();
    expect(warnDeprecated('legacy-import', { emit, env: {} })).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('survives an unreadable environment', () => {
    const env = new Proxy(
      {},
      {
        get: () => {
          throw new Error('denied');
        },
      }
    ) as Record<string, string>;
    expect(() => warnDeprecated('legacy-import', { emit: vi.fn(), env })).not.toThrow();
  });
});

describe('warnDeprecated — restart / replay', () => {
  it('warns again after the process state is reset', () => {
    const emit = vi.fn();
    warnDeprecated('legacy-import', { emit, env: {} });
    resetDeprecationWarnings();
    expect(getEmittedDeprecations()).toEqual([]);
    expect(warnDeprecated('legacy-import', { emit, env: {} })).toBe(true);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

describe('DEPRECATION_NOTICES registry', () => {
  it('has a unique ILN_SDK_DEPRECATED_* code, a replacement and a docs anchor for every notice', () => {
    const codes = new Set<string>();
    for (const [id, notice] of Object.entries(DEPRECATION_NOTICES)) {
      expect(notice.id).toBe(id);
      expect(notice.code).toMatch(/^ILN_SDK_DEPRECATED_[A-Z_]+$/);
      expect(codes.has(notice.code)).toBe(false);
      codes.add(notice.code);
      expect(notice.replacement.length).toBeGreaterThan(0);
      expect(notice.docs).toMatch(/^docs\/sdk-migration-guide\.md#/);
    }
  });
});
