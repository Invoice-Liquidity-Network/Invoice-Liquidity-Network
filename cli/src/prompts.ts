import * as readline from 'readline';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PromptOptions {
  /** The prompt message to display. */
  message: string;
  /** Default value if the user presses Enter without typing. */
  defaultValue?: string;
  /** Whether to mask input (e.g. for secrets). */
  mask?: boolean;
  /** Custom validation function. Returns error message or null. */
  validate?: (input: string) => string | null;
}

export interface SelectPromptOptions {
  /** The prompt message to display. */
  message: string;
  /** Available options. */
  options: Array<{ label: string; value: string; description?: string }>;
  /** Default value. */
  defaultValue?: string;
}

export interface ConfirmPromptOptions {
  /** The prompt message to display. */
  message: string;
  /** Default value (true/false). */
  defaultValue?: boolean;
}

export interface PromptResult<T = string> {
  value: T;
  cancelled: boolean;
}

// ── Prompt Functions ─────────────────────────────────────────────────────────

/**
 * Create a readline interface for interactive prompts.
 */
function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

/**
 * Ask the user a text input question.
 *
 * @param options - Prompt configuration.
 * @returns The user's input or the default value.
 *
 * @example
 * ```ts
 * const name = await prompt({ message: "Enter your name:", defaultValue: "Guest" });
 * console.log(`Hello, ${name}!`);
 * ```
 */
export async function prompt(options: PromptOptions): Promise<string> {
  const rl = createInterface();

  return new Promise<string>((resolve) => {
    const defaultDisplay = options.defaultValue ? ` (${options.defaultValue})` : '';
    const maskChar = options.mask ? '*'.repeat(8) : '';
    const promptText = `${options.message}${defaultDisplay}${maskChar ? ' ' + maskChar : ''}: `;

    const ask = () => {
      rl.question(promptText, (answer) => {
        const value = answer.trim() || options.defaultValue || '';

        if (options.validate) {
          const error = options.validate(value);
          if (error) {
            console.error(`  Invalid: ${error}`);
            ask();
            return;
          }
        }

        rl.close();
        resolve(value);
      });
    };

    ask();
  });
}

/**
 * Ask the user to select from a list of options.
 *
 * @param options - Select prompt configuration.
 * @returns The selected value.
 *
 * @example
 * ```ts
 * const network = await select({
 *   message: "Select network:",
 *   options: [
 *     { label: "Testnet", value: "testnet" },
 *     { label: "Mainnet", value: "mainnet" },
 *   ],
 * });
 * ```
 */
export async function select(options: SelectPromptOptions): Promise<string> {
  const rl = createInterface();

  return new Promise<string>((resolve) => {
    console.error(`\n${options.message}`);
    options.options.forEach((opt, i) => {
      const marker = opt.value === options.defaultValue ? ' (default)' : '';
      console.error(`  ${i + 1}. ${opt.label}${marker}`);
      if (opt.description) {
        console.error(`     ${opt.description}`);
      }
    });

    const defaultIndex = options.defaultValue
      ? options.options.findIndex((o) => o.value === options.defaultValue)
      : -1;
    const defaultDisplay = defaultIndex >= 0 ? ` [${defaultIndex + 1}]` : '';

    rl.question(`\nSelect an option${defaultDisplay}: `, (answer) => {
      rl.close();

      const index = parseInt(answer.trim(), 10) - 1;
      if (index >= 0 && index < options.options.length) {
        resolve(options.options[index].value);
      } else if (options.defaultValue) {
        resolve(options.defaultValue);
      } else {
        resolve(options.options[0].value);
      }
    });
  });
}

/**
 * Ask the user a yes/no confirmation question.
 *
 * @param options - Confirm prompt configuration.
 * @returns `true` for yes, `false` for no.
 *
 * @example
 * ```ts
 * const confirmed = await confirm({ message: "Continue?", defaultValue: true });
 * if (confirmed) {
 *   console.log("Proceeding...");
 * }
 * ```
 */
export async function confirm(options: ConfirmPromptOptions): Promise<boolean> {
  const rl = createInterface();
  const defaultStr =
    options.defaultValue === true ? 'Y/n' : options.defaultValue === false ? 'y/N' : 'y/n';

  return new Promise<boolean>((resolve) => {
    rl.question(`${options.message} [${defaultStr}]: `, (answer) => {
      rl.close();

      const normalized = answer.trim().toLowerCase();
      if (normalized === '' || normalized === 'y' || normalized === 'yes') {
        resolve(options.defaultValue !== false);
      } else if (normalized === 'n' || normalized === 'no') {
        resolve(false);
      } else {
        resolve(options.defaultValue ?? false);
      }
    });
  });
}

/**
 * Prompt for a secret value (masked input).
 *
 * @param message - The prompt message.
 * @returns The entered secret value.
 */
export async function secret(message: string): Promise<string> {
  return prompt({ message, mask: true });
}

// ── Argument Prompting ───────────────────────────────────────────────────────

export interface ArgumentDefinition {
  /** The argument/option name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Whether this argument is required. */
  required: boolean;
  /** Default value. */
  defaultValue?: string;
  /** Custom validation. */
  validate?: (input: string) => string | null;
}

/**
 * Detect and prompt for missing required arguments.
 * Only prompts in interactive TTY environments.
 *
 * @param definitions - Argument definitions to check.
 * @param providedValues - Values already provided via CLI flags.
 * @returns Object with all resolved values.
 *
 * @example
 * ```ts
 * const values = await promptMissingArguments(
 *   [
 *     { name: "payer", description: "Payer address", required: true },
 *     { name: "amount", description: "Invoice amount", required: true },
 *   ],
 *   { payer: "GABC..." }, // amount was not provided
 * );
 * // Will prompt for amount interactively
 * ```
 */
export async function promptMissingArguments(
  definitions: ArgumentDefinition[],
  providedValues: Record<string, string | undefined>
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};

  for (const def of definitions) {
    const provided = providedValues[def.name];
    if (provided !== undefined && provided !== '') {
      resolved[def.name] = provided;
      continue;
    }

    if (!def.required) {
      if (def.defaultValue !== undefined) {
        resolved[def.name] = def.defaultValue;
      }
      continue;
    }

    // Only prompt if we're in a TTY
    if (!process.stdin.isTTY) {
      throw new Error(
        `Missing required argument: --${def.name}. ${def.description}. ` +
          `Provide it via --${def.name} <value> or run interactively in a terminal.`
      );
    }

    const value = await prompt({
      message: `${def.description}:`,
      defaultValue: def.defaultValue,
      validate: def.validate,
    });

    resolved[def.name] = value;
  }

  return resolved;
}

// ── Common Validators ────────────────────────────────────────────────────────

/**
 * Validate a Stellar address (G... format).
 */
export function validateStellarAddress(value: string): string | null {
  if (!value.startsWith('G') || value.length < 56) {
    return 'Must be a valid Stellar address (starts with G, 56 characters)';
  }
  return null;
}

/**
 * Validate a positive integer.
 */
export function validatePositiveInteger(value: string): string | null {
  if (!/^\d+$/.test(value) || parseInt(value, 10) <= 0) {
    return 'Must be a positive integer';
  }
  return null;
}

/**
 * Validate a positive decimal number.
 */
export function validatePositiveNumber(value: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(value) || parseFloat(value) <= 0) {
    return 'Must be a positive number';
  }
  return null;
}

/**
 * Validate a date string (YYYY-MM-DD) or Unix timestamp.
 */
export function validateDate(value: string): string | null {
  // Check if it's a Unix timestamp
  if (/^\d+$/.test(value)) {
    const ts = parseInt(value, 10);
    if (ts <= Math.floor(Date.now() / 1000)) {
      return 'Timestamp must be in the future';
    }
    return null;
  }

  // Check if it's a YYYY-MM-DD date
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(value)) {
    return 'Must be a date (YYYY-MM-DD) or Unix timestamp';
  }

  const date = new Date(value + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }

  if (date <= new Date()) {
    return 'Date must be in the future';
  }

  return null;
}

/**
 * Validate a basis points value (0-10000).
 */
export function validateBasisPoints(value: string): string | null {
  if (!/^\d+$/.test(value)) {
    return 'Must be a non-negative integer';
  }
  const bps = parseInt(value, 10);
  if (bps < 0 || bps > 10000) {
    return 'Must be between 0 and 10000 basis points';
  }
  return null;
}
