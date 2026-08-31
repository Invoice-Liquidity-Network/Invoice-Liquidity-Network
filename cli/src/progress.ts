/**
 * CLI progress indicators — spinners, progress bars, and status messages.
 *
 * Supports TTY animation with clean completion; falls back to plain status
 * lines when stdout is not a TTY (tests, pipes, CI).
 *
 * Exports:
 *   createSpinner            — indeterminate spinner for unknown-duration ops
 *   createProgressBar        — determinate bar with ETA for multi-step ops
 *   withSpinner              — async wrapper that stops the spinner on resolve/reject
 *   withProgressBar          — async wrapper that stops the bar on resolve/reject
 *   createTransactionProgress — 4-step bar (build → simulate → sign → submit)
 */

import pc from 'picocolors';

export interface ProgressOptions {
  /** Output stream (defaults to process.stdout). */
  output?: NodeJS.WritableStream;
  /** When false, suppress progress output entirely. */
  enabled?: boolean;
}

export interface Spinner {
  /** Replace the current status message. */
  update(message: string): void;
  /** Stop and print a green success line. */
  succeed(message?: string): void;
  /** Stop and print a red failure line. */
  fail(message?: string): void;
  /** Stop without printing a completion line. */
  stop(): void;
}

export interface ProgressBar {
  /** Set absolute progress and optionally update the status message. */
  update(current: number, message?: string): void;
  /** Advance progress by `step` (default 1) and optionally update the message. */
  increment(step?: number, message?: string): void;
  /** Complete the bar and print a green success line. */
  succeed(message?: string): void;
  /** Stop the bar and print a red failure line. */
  fail(message?: string): void;
  /** Stop without printing a completion line. */
  stop(): void;
}

/**
 * A fixed 4-phase transaction progress handle.
 * Call each phase method in order, then `succeed` or `fail`.
 */
export interface TransactionProgress {
  /** Mark the "building transaction" phase complete and advance to simulate. */
  built(): void;
  /** Mark the "simulating" phase complete and advance to sign. */
  simulated(): void;
  /** Mark the "signing" phase complete and advance to submit. */
  signed(): void;
  /** Mark all phases complete and print a green success line. */
  succeed(message?: string): void;
  /** Abort and print a red failure line. */
  fail(message?: string): void;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;
const BAR_WIDTH = 24;

/** Labels for each of the 4 transaction steps. */
const TX_STEPS = ['Building', 'Simulating', 'Signing', 'Submitting'] as const;
const TX_TOTAL = TX_STEPS.length;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveEnabled(options?: ProgressOptions): boolean {
  if (options?.enabled === false) return false;
  const stream = options?.output ?? process.stdout;
  return Boolean((stream as NodeJS.WriteStream).isTTY);
}

function writeLine(output: NodeJS.WritableStream, line: string): void {
  output.write(`${line}\n`);
}

function clearLine(output: NodeJS.WritableStream, width: number): void {
  output.write(`\r${' '.repeat(width)}\r`);
}

/**
 * Format elapsed seconds as a human-readable string, e.g. "1.2s" or "1m 03s".
 */
function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/**
 * Format an ETA string. Returns empty string when there is not enough data.
 *
 * @param current  Number of completed steps.
 * @param total    Total number of steps.
 * @param elapsed  Elapsed milliseconds since start.
 */
function formatEta(current: number, total: number, elapsed: number): string {
  if (current <= 0 || total <= 0 || elapsed <= 0) return '';
  const rate = current / elapsed; // steps per ms
  const remaining = (total - current) / rate; // ms
  const etaSec = remaining / 1000;
  if (etaSec < 0.5) return pc.dim('ETA <1s');
  return pc.dim(`ETA ${formatElapsed(etaSec)}`);
}

function formatBar(current: number, total: number): string {
  const ratio = total > 0 ? Math.min(current / total, 1) : 0;
  const filled = Math.round(ratio * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const percent = Math.round(ratio * 100);
  const bar = `${pc.green('█'.repeat(filled))}${pc.dim('░'.repeat(empty))}`;
  return `[${bar}] ${pc.bold(String(percent).padStart(3))}% (${current}/${total})`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start an indeterminate spinner for long-running operations.
 */
export function createSpinner(message: string, options?: ProgressOptions): Spinner {
  const output = options?.output ?? process.stdout;
  const silent = options?.enabled === false;
  const animated = resolveEnabled(options);
  let messageText = message;
  let frame = 0;
  let active = true;
  let interval: ReturnType<typeof setInterval> | undefined;

  const renderFrame = (): string => `${pc.cyan(SPINNER_FRAMES[frame])} ${messageText}`;

  const renderLine = (): void => {
    if (!active) return;
    if (animated) {
      output.write(`\r${renderFrame()}`);
    }
  };

  const emitStatic = (): void => {
    writeLine(output, `${pc.cyan(SPINNER_FRAMES[0])} ${messageText}`);
  };

  if (animated) {
    output.write(`\r${renderFrame()}`);
    interval = setInterval(() => {
      frame = (frame + 1) % SPINNER_FRAMES.length;
      renderLine();
    }, SPINNER_INTERVAL_MS);
  } else if (!silent) {
    emitStatic();
  }

  const finish = (line?: string): void => {
    if (!active) return;
    active = false;
    if (interval) clearInterval(interval);
    if (animated) {
      clearLine(output, messageText.length + 6);
    }
    if (line && !silent) writeLine(output, line);
  };

  return {
    update(nextMessage: string) {
      messageText = nextMessage;
      if (!active) return;
      if (animated) {
        renderLine();
      } else if (!silent) {
        writeLine(output, `${pc.cyan('→')} ${nextMessage}`);
      }
    },
    succeed(message?: string) {
      finish(message ? `${pc.green('✓')} ${message}` : undefined);
    },
    fail(message?: string) {
      finish(message ? `${pc.red('✗')} ${message}` : undefined);
    },
    stop() {
      finish();
    },
  };
}

/**
 * Start a determinate progress bar for multi-step operations.
 *
 * The bar automatically tracks elapsed time and computes an ETA after the
 * first step completes.
 */
export function createProgressBar(
  total: number,
  message: string,
  options?: ProgressOptions
): ProgressBar {
  const output = options?.output ?? process.stdout;
  const silent = options?.enabled === false;
  const animated = resolveEnabled(options);
  let messageText = message;
  let current = 0;
  let active = true;
  const startedAt = Date.now();

  const render = (): string => {
    const elapsed = Date.now() - startedAt;
    const eta = formatEta(current, total, elapsed);
    const bar = formatBar(current, total);
    const elapsedStr = elapsed >= 500 ? pc.dim(` [${formatElapsed(elapsed / 1000)}]`) : '';
    return `${bar} ${messageText}${elapsedStr}${eta ? `  ${eta}` : ''}`;
  };

  const paint = (): void => {
    if (!active) return;
    if (animated) {
      output.write(`\r${render()}`);
    }
  };

  if (animated) {
    paint();
  } else if (!silent) {
    writeLine(output, render());
  }

  const finish = (line?: string): void => {
    if (!active) return;
    active = false;
    if (animated) {
      // Clear enough width to cover the widest possible rendered line
      clearLine(output, messageText.length + BAR_WIDTH + 48);
    }
    if (line && !silent) writeLine(output, line);
  };

  const setProgress = (next: number, nextMessage?: string): void => {
    current = Math.max(0, Math.min(next, total));
    if (nextMessage !== undefined) messageText = nextMessage;
    if (!active) return;
    if (animated) {
      paint();
    } else if (!silent) {
      writeLine(output, render());
    }
  };

  return {
    update(next: number, nextMessage?: string) {
      setProgress(next, nextMessage);
    },
    increment(step = 1, nextMessage?: string) {
      setProgress(current + step, nextMessage);
    },
    succeed(message?: string) {
      if (current < total) setProgress(total);
      finish(message ? `${pc.green('✓')} ${message}` : undefined);
    },
    fail(message?: string) {
      finish(message ? `${pc.red('✗')} ${message}` : undefined);
    },
    stop() {
      finish();
    },
  };
}

/**
 * Create a 4-phase transaction progress bar: Build → Simulate → Sign → Submit.
 *
 * Usage:
 * ```ts
 * const tx = createTransactionProgress("Submitting invoice", options);
 * // ... build transaction
 * tx.built();
 * // ... simulate
 * tx.simulated();
 * // ... sign
 * tx.signed();
 * // ... broadcast
 * tx.succeed("Invoice 42 submitted in tx abc…");
 * ```
 */
export function createTransactionProgress(
  label: string,
  options?: ProgressOptions
): TransactionProgress {
  const bar = createProgressBar(TX_TOTAL, `${label} — ${TX_STEPS[0]}…`, options);

  return {
    built() {
      bar.increment(1, `${label} — ${TX_STEPS[1]}…`);
    },
    simulated() {
      bar.increment(1, `${label} — ${TX_STEPS[2]}…`);
    },
    signed() {
      bar.increment(1, `${label} — ${TX_STEPS[3]}…`);
    },
    succeed(message?: string) {
      bar.succeed(message);
    },
    fail(message?: string) {
      bar.fail(message ?? `${label} failed`);
    },
  };
}

/**
 * Run `fn` behind a spinner that stops on success or failure.
 *
 * @param message      Initial spinner message.
 * @param fn           Async work to perform.
 * @param options      Progress options (output stream, enabled flag).
 * @param successMsg   Optional message to print on success. When omitted the
 *                     spinner simply disappears without a completion line.
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  options?: ProgressOptions,
  successMsg?: string
): Promise<T> {
  const spinner = createSpinner(message, options);
  try {
    const result = await fn();
    if (successMsg) {
      spinner.succeed(successMsg);
    } else {
      spinner.stop();
    }
    return result;
  } catch (error) {
    spinner.fail(message);
    throw error;
  }
}

/**
 * Run `fn` behind a progress bar; call `bar.increment()` inside `fn` as steps complete.
 */
export async function withProgressBar<T>(
  total: number,
  message: string,
  fn: (bar: ProgressBar) => Promise<T>,
  options?: ProgressOptions
): Promise<T> {
  const bar = createProgressBar(total, message, options);
  try {
    const result = await fn(bar);
    bar.stop();
    return result;
  } catch (error) {
    bar.fail(message);
    throw error;
  }
}
