/**
 * Migration warnings for the deprecated `@iln/sdk` surface (issue #1222).
 *
 * The compatibility shim shipped at `@iln/sdk/legacy` (#1219) re-exports the
 * whole public API so old import sites keep working, but it is a migration
 * aid, not a supported entry point. Before this module it was silent: nothing
 * told an integrator they were on a path that is scheduled for removal.
 *
 * Contract:
 *  - one warning per notice id per process (restart/replay emits it again —
 *    that is the point: an operator who restarts a service sees it in the new
 *    log);
 *  - emitted as a Node `DeprecationWarning` (stderr, `process.on('warning')`,
 *    honours `--no-deprecation`), or `console.warn` where `process.emitWarning`
 *    does not exist (browsers, React Native);
 *  - can be silenced explicitly with `ILN_SDK_SUPPRESS_DEPRECATION_WARNINGS=1`;
 *  - never throws and never affects the call it is attached to — a broken
 *    logger must not turn a deprecation into an outage.
 */

export interface DeprecationNotice {
  /** Stable identifier; also the dedupe key. */
  id: string;
  /** Node warning code, `ILN_SDK_DEPRECATED_*`. */
  code: string;
  /** What is deprecated, as an integrator would recognise it. */
  surface: string;
  /** What to use instead. */
  replacement: string;
  /** SDK version in which the surface is scheduled for removal. */
  removedIn: string;
  /** Where the step-by-step migration lives. */
  docs: string;
}

/** Deprecated SDK surface that emits a runtime warning. Keep in sync with docs/sdk-migration-guide.md. */
export const DEPRECATION_NOTICES: Readonly<Record<string, DeprecationNotice>> = Object.freeze({
  'legacy-import': Object.freeze({
    id: 'legacy-import',
    code: 'ILN_SDK_DEPRECATED_LEGACY_IMPORT',
    surface: "the '@iln/sdk/legacy' import path",
    replacement: "import from '@iln/sdk'",
    removedIn: '1.0.0',
    docs: 'docs/sdk-migration-guide.md#deprecated-sdk-surface',
  }),
});

/** Set to `1`/`true` to silence every migration warning (CI logs, known-and-accepted debt). */
export const SUPPRESS_DEPRECATION_ENV = 'ILN_SDK_SUPPRESS_DEPRECATION_WARNINGS';

export interface DeprecationEvent {
  notice: DeprecationNotice;
  message: string;
}

export interface WarnDeprecatedOptions {
  /** Override the sink (tests, custom loggers). Defaults to `process.emitWarning` / `console.warn`. */
  emit?: (event: DeprecationEvent) => void;
  /** Override `process.env` lookups (tests, non-Node hosts). */
  env?: Record<string, string | undefined>;
}

const emitted = new Set<string>();

export function formatDeprecationMessage(notice: DeprecationNotice): string {
  return (
    `[@iln/sdk] ${notice.surface} is deprecated and will be removed in @iln/sdk ${notice.removedIn}. ` +
    `Migrate: ${notice.replacement}. See ${notice.docs}. ` +
    `Silence with ${SUPPRESS_DEPRECATION_ENV}=1.`
  );
}

function isSuppressed(env?: Record<string, string | undefined>): boolean {
  try {
    const source =
      env ??
      (typeof process !== 'undefined' && process.env
        ? process.env
        : ({} as Record<string, string>));
    const value = source[SUPPRESS_DEPRECATION_ENV];
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

function defaultEmit({ notice, message }: DeprecationEvent): void {
  if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
    process.emitWarning(message, { type: 'DeprecationWarning', code: notice.code });
    return;
  }
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`${notice.code}: ${message}`);
  }
}

/**
 * Emit the migration warning for `id` once per process.
 *
 * @returns `true` when a warning was emitted by this call; `false` when it was
 *          already emitted, suppressed, unknown, or the sink failed.
 */
export function warnDeprecated(id: string, options: WarnDeprecatedOptions = {}): boolean {
  const notice = DEPRECATION_NOTICES[id];
  if (!notice) return false;
  if (isSuppressed(options.env)) return false;
  if (emitted.has(id)) return false;
  // Mark first: a sink that throws (or re-enters) must not cause a warning storm.
  emitted.add(id);
  try {
    (options.emit ?? defaultEmit)({ notice, message: formatDeprecationMessage(notice) });
    return true;
  } catch {
    return false;
  }
}

/** Notice ids that have been emitted in this process — operator-visible proof the control fired. */
export function getEmittedDeprecations(): string[] {
  return [...emitted].sort();
}

/** Forget emitted notices. Intended for tests that simulate a process restart. */
export function resetDeprecationWarnings(): void {
  emitted.clear();
}
