/**
 * Interactive mode for the ILN CLI (#444)
 *
 * Starts with `iln interactive`.
 *
 * Guides the user through invoice operations step-by-step using text prompts,
 * with colored output and a progress indicator during transaction submission.
 *
 * No external prompt library is required — everything is built on Node.js
 * `readline` to avoid adding heavy dependencies.
 */

import { createInterface } from 'node:readline';
import pc from 'picocolors';

import { parseDisplayAmount } from './amounts';
import { parseDueDate } from './dates';
import { formatInvoiceDetails, formatInvoiceList } from './format';
import { createSpinner } from './progress';
import type { ILNClient } from './client';
import type { Ui } from './format';
import type { ResolvedConfig } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InteractiveDependencies {
  client: ILNClient;
  config: ResolvedConfig;
  ui: Ui;
  /** Replaceable stdin stream for testing. */
  input?: NodeJS.ReadableStream;
  /** Replaceable stdout stream for testing. */
  output?: NodeJS.WritableStream;
}

type MenuChoice = 'submit' | 'fund' | 'pay' | 'status' | 'list' | 'exit';

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * Start the interactive mode.  Returns when the user chooses "exit".
 */
export async function runInteractive(deps: InteractiveDependencies): Promise<void> {
  const { client, config, ui } = deps;
  const rl = createInterface({
    input: deps.input ?? process.stdin,
    output: deps.output ?? process.stdout,
    terminal: false,
  });

  const ask = makeAsker(rl);

  ui.info(pc.bold('\n  Invoice Liquidity Network — Interactive Mode'));
  ui.info(`  Network : ${pc.cyan(config.network)}`);
  ui.info(`  Contract: ${pc.cyan(config.contractId)}\n`);

  try {
    // eslint-disable-next-line no-constant-condition -- loop exits via internal break
    while (true) {
      const choice = await promptMenu(ask, ui);
      if (choice === 'exit') break;

      try {
        await dispatchAction(choice, { ask, client, config, ui, output: deps.output });
      } catch (err) {
        ui.error(err instanceof Error ? err.message : String(err));
        const retry = await ask(pc.yellow('An error occurred. Continue? [Y/n] '));
        if (retry.trim().toLowerCase() === 'n') break;
      }

      ui.info(''); // blank line between operations
    }
  } finally {
    rl.close();
  }

  ui.info(pc.bold('Goodbye.\n'));
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

async function promptMenu(ask: Asker, ui: Ui): Promise<MenuChoice> {
  ui.info(pc.bold('What would you like to do?'));
  ui.info(`  ${pc.cyan('1')} Submit invoice`);
  ui.info(`  ${pc.cyan('2')} Fund invoice`);
  ui.info(`  ${pc.cyan('3')} Mark invoice as paid`);
  ui.info(`  ${pc.cyan('4')} Check invoice status`);
  ui.info(`  ${pc.cyan('5')} List invoices for an address`);
  ui.info(`  ${pc.cyan('0')} Exit`);

  const map: Record<string, MenuChoice> = {
    '1': 'submit',
    '2': 'fund',
    '3': 'pay',
    '4': 'status',
    '5': 'list',
    '0': 'exit',
  };

  // eslint-disable-next-line no-constant-condition -- loop exits via internal break
  while (true) {
    const input = (await ask(pc.bold('\nChoose [0-5]: '))).trim();
    if (map[input]) return map[input];
    ui.warn(`Invalid choice "${input}". Please enter a number between 0 and 5.`);
  }
}

// ─── Action dispatcher ────────────────────────────────────────────────────────

interface ActionDeps {
  ask: Asker;
  client: ILNClient;
  config: ResolvedConfig;
  ui: Ui;
  output?: NodeJS.WritableStream;
}

function spinnerOptions(deps: ActionDeps) {
  return { output: deps.output ?? process.stdout };
}

async function dispatchAction(choice: MenuChoice, deps: ActionDeps): Promise<void> {
  switch (choice) {
    case 'submit':
      return submitInvoice(deps);
    case 'fund':
      return fundInvoice(deps);
    case 'pay':
      return markPaid(deps);
    case 'status':
      return checkStatus(deps);
    case 'list':
      return listInvoices(deps);
  }
}

// ─── Submit invoice ───────────────────────────────────────────────────────────

async function submitInvoice(deps: ActionDeps): Promise<void> {
  const { ask, client, config, ui } = deps;
  ui.info(pc.bold('\n── Submit Invoice ──'));

  const payer = await askValidated(ask, ui, 'Payer Stellar address: ', validateStellarAddress);
  const amount = await askValidated(
    ask,
    ui,
    'Invoice amount (e.g. 100 or 12.50): ',
    validateAmount
  );
  const due = await askValidated(
    ask,
    ui,
    'Due date (YYYY-MM-DD or Unix timestamp): ',
    validateDueDate
  );
  const rate = await askValidated(
    ask,
    ui,
    'Discount rate in basis points (e.g. 300): ',
    validateBasisPoints
  );

  const tokenId = config.tokenId;
  if (!tokenId) {
    throw new Error(
      'Token ID is not configured. Set `contractIds.token` in your config file or `ILN_TOKEN_ID`.'
    );
  }

  const confirmed = await confirmAction(ask, ui, [
    ['Payer', payer],
    ['Amount', amount],
    ['Due', due],
    ['Rate', `${rate} bps`],
    ['Token', tokenId],
  ]);
  if (!confirmed) {
    ui.warn('Cancelled.');
    return;
  }

  const spinner = createSpinner('Submitting transaction…', spinnerOptions(deps));
  try {
    const { invoiceId, txHash } = await client.submitInvoice({
      amount: parseDisplayAmount(amount),
      discountRate: Number(rate),
      dueDate: parseDueDate(due),
      payer,
      tokenId,
    });
    spinner.succeed(`Invoice ${pc.bold(invoiceId.toString())} submitted in tx ${pc.cyan(txHash)}`);
  } catch (err) {
    spinner.fail('Transaction submission failed');
    throw err;
  }
}

// ─── Fund invoice ─────────────────────────────────────────────────────────────

async function fundInvoice(deps: ActionDeps): Promise<void> {
  const { ask, client, ui } = deps;
  ui.info(pc.bold('\n── Fund Invoice ──'));

  const id = await askValidated(ask, ui, 'Invoice ID: ', validateInvoiceId);
  const amountInput = (await ask('Amount to fund (leave blank to fund full balance): ')).trim();

  const confirmed = await confirmAction(ask, ui, [
    ['Invoice ID', id],
    ['Amount', amountInput || '(full balance)'],
  ]);
  if (!confirmed) {
    ui.warn('Cancelled.');
    return;
  }

  const spinner = createSpinner('Submitting transaction…', spinnerOptions(deps));
  try {
    const amount = amountInput ? parseDisplayAmount(amountInput) : undefined;
    const result = await client.fundInvoice(BigInt(id), amount);
    spinner.succeed(`Invoice ${pc.bold(id)} funded in tx ${pc.cyan(result.hash)}`);
  } catch (err) {
    spinner.fail('Transaction submission failed');
    throw err;
  }
}

// ─── Mark paid ────────────────────────────────────────────────────────────────

async function markPaid(deps: ActionDeps): Promise<void> {
  const { ask, client, ui } = deps;
  ui.info(pc.bold('\n── Mark Invoice as Paid ──'));

  const id = await askValidated(ask, ui, 'Invoice ID: ', validateInvoiceId);

  const confirmed = await confirmAction(ask, ui, [['Invoice ID', id]]);
  if (!confirmed) {
    ui.warn('Cancelled.');
    return;
  }

  const spinner = createSpinner('Submitting transaction…', spinnerOptions(deps));
  try {
    const result = await client.markPaid(BigInt(id));
    spinner.succeed(`Invoice ${pc.bold(id)} marked as paid in tx ${pc.cyan(result.hash)}`);
  } catch (err) {
    spinner.fail('Transaction submission failed');
    throw err;
  }
}

// ─── Check status ─────────────────────────────────────────────────────────────

async function checkStatus(deps: ActionDeps): Promise<void> {
  const { ask, client, ui } = deps;
  ui.info(pc.bold('\n── Invoice Status ──'));

  const id = await askValidated(ask, ui, 'Invoice ID: ', validateInvoiceId);

  const spinner = createSpinner('Fetching invoice…', spinnerOptions(deps));
  try {
    const invoice = await client.getInvoice(BigInt(id));
    spinner.stop();
    ui.info(formatInvoiceDetails(invoice));
  } catch (err) {
    spinner.fail('Failed to fetch invoice');
    throw err;
  }
}

// ─── List invoices ────────────────────────────────────────────────────────────

async function listInvoices(deps: ActionDeps): Promise<void> {
  const { ask, client, ui } = deps;
  ui.info(pc.bold('\n── List Invoices ──'));

  const address = await askValidated(
    ask,
    ui,
    'Stellar address (freelancer, payer, or funder): ',
    validateStellarAddress
  );

  const spinner = createSpinner('Fetching invoices…', spinnerOptions(deps));
  try {
    const invoices = await client.listInvoicesByAddress(address);
    spinner.stop();
    ui.info(formatInvoiceList(invoices));
  } catch (err) {
    spinner.fail('Failed to fetch invoices');
    throw err;
  }
}

// ─── Validators ───────────────────────────────────────────────────────────────

type Validator = (value: string) => string | null; // returns error message or null

function validateStellarAddress(value: string): string | null {
  // Stellar G-addresses are 56 characters, starting with G
  if (/^G[A-Z2-7]{55}$/.test(value.trim())) return null;
  return 'Invalid Stellar address. It must be a 56-character Ed25519 public key starting with G.';
}

function validateAmount(value: string): string | null {
  if (/^\d+(\.\d{1,7})?$/.test(value.trim()) && Number(value) > 0) return null;
  return 'Invalid amount. Use a positive decimal value with up to 7 fractional digits (e.g. 100 or 12.5).';
}

function validateDueDate(value: string): string | null {
  try {
    parseDueDate(value);
    return null;
  } catch {
    return 'Invalid date. Use YYYY-MM-DD or a Unix timestamp.';
  }
}

function validateBasisPoints(value: string): string | null {
  if (/^\d+$/.test(value.trim()) && Number(value) >= 0) return null;
  return 'Invalid rate. Use a non-negative integer (e.g. 300 for 3%).';
}

function validateInvoiceId(value: string): string | null {
  if (/^\d+$/.test(value.trim()) && Number(value) > 0) return null;
  return 'Invalid invoice ID. Use a positive integer.';
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

type Asker = (prompt: string) => Promise<string>;

function makeAsker(rl: ReturnType<typeof createInterface>): Asker {
  return (prompt: string) =>
    new Promise<string>((resolve) => {
      rl.question(prompt, resolve);
    });
}

async function askValidated(
  ask: Asker,
  ui: Ui,
  prompt: string,
  validate: Validator
): Promise<string> {
  // eslint-disable-next-line no-constant-condition -- loop exits via internal break
  while (true) {
    const value = (await ask(pc.bold(prompt))).trim();
    const error = validate(value);
    if (!error) return value;
    ui.warn(error);
  }
}

async function confirmAction(
  ask: Asker,
  ui: Ui,
  fields: Array<[label: string, value: string]>
): Promise<boolean> {
  ui.info(pc.bold('\nPlease confirm:'));
  for (const [label, value] of fields) {
    ui.info(`  ${pc.cyan(label.padEnd(12))} ${value}`);
  }
  const answer = (await ask(pc.bold('\nProceed? [Y/n] '))).trim().toLowerCase();
  return answer !== 'n';
}
