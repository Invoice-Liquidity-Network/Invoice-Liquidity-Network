/**
 * Interactive tutorial mode for the ILN CLI (#592).
 *
 * Guides new users through their first invoice submission step-by-step,
 * with explanations at each stage, a skip option, and a resume capability
 * backed by a lightweight progress file.
 */

import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pc from 'picocolors';

import { parseDisplayAmount } from './amounts';
import { parseDueDate } from './dates';
import type { ILNClient } from './client';
import type { Ui } from './format';
import type { ResolvedConfig } from './types';

// ── Constants ─────────────────────────────────────────────────────────────

const PROGRESS_FILE = path.join(os.homedir(), '.iln', 'tutorial-progress.json');

// ── Types ─────────────────────────────────────────────────────────────────

export interface TutorialDependencies {
  client: ILNClient;
  config: ResolvedConfig;
  ui: Ui;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

type StepId =
  | 'welcome'
  | 'explain-invoice'
  | 'explain-network'
  | 'enter-payer'
  | 'enter-amount'
  | 'enter-due-date'
  | 'enter-rate'
  | 'confirm-submit'
  | 'submit'
  | 'done';

interface TutorialProgress {
  completedSteps: StepId[];
  savedInputs: Partial<InvoiceInputs>;
  startedAt: string;
  completedAt?: string;
}

interface InvoiceInputs {
  payer: string;
  amount: string;
  dueDate: string;
  rate: string;
}

// ── Progress persistence ───────────────────────────────────────────────────

function loadProgress(): TutorialProgress | null {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) return null;
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) as TutorialProgress;
  } catch {
    return null;
  }
}

function saveProgress(progress: TutorialProgress): void {
  try {
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch {
    // Silently skip — persistence is best-effort
  }
}

function clearProgress(): void {
  try {
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  } catch {
    // Silently skip
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
  validate: (v: string) => string | null
): Promise<string> {
  // eslint-disable-next-line no-constant-condition -- loop exits via internal break
  while (true) {
    const value = (await ask(pc.bold(prompt))).trim();
    if (value.toLowerCase() === 'skip') return 'skip';
    const error = validate(value);
    if (!error) return value;
    ui.warn(error);
  }
}

function printDivider(ui: Ui): void {
  ui.info(pc.dim('─'.repeat(60)));
}

function printStep(ui: Ui, step: number, total: number, title: string): void {
  ui.info(`\n${pc.bold(pc.cyan(`Step ${step}/${total}`))} — ${pc.bold(title)}`);
  printDivider(ui);
}

function printExplanation(ui: Ui, lines: string[]): void {
  for (const line of lines) {
    ui.info(`  ${pc.dim(line)}`);
  }
  ui.info('');
}

// ── Validators ────────────────────────────────────────────────────────────

function validateStellarAddress(v: string): string | null {
  if (/^G[A-Z2-7]{55}$/.test(v)) return null;
  return 'Must be a 56-character Stellar public key starting with G.';
}

function validateAmount(v: string): string | null {
  if (/^\d+(\.\d{1,7})?$/.test(v) && Number(v) > 0) return null;
  return 'Must be a positive decimal with up to 7 fractional digits (e.g. 100 or 12.5).';
}

function validateDueDate(v: string): string | null {
  try {
    parseDueDate(v);
    return null;
  } catch {
    return 'Must be YYYY-MM-DD or a Unix timestamp.';
  }
}

function validateBasisPoints(v: string): string | null {
  if (/^\d+$/.test(v) && Number(v) >= 0) return null;
  return 'Must be a non-negative integer (e.g. 300 for 3%).';
}

// ── Tutorial steps ────────────────────────────────────────────────────────

const TOTAL_STEPS = 7;

async function stepWelcome(ask: Asker, ui: Ui, resumed: boolean): Promise<boolean> {
  ui.info(pc.bold('\n  Welcome to the ILN CLI Tutorial!\n'));
  ui.info(
    '  This tutorial walks you through submitting your first invoice on\n' +
      '  the Invoice Liquidity Network — a Stellar-based protocol that lets\n' +
      '  freelancers get paid early at a small discount.\n'
  );

  if (resumed) {
    ui.info(pc.green('  Resuming from where you left off.\n'));
  }

  const answer = (await ask(pc.bold("  Press Enter to begin, or type 'skip' to exit: "))).trim();
  return answer.toLowerCase() !== 'skip';
}

async function stepExplainInvoice(ask: Asker, ui: Ui): Promise<boolean> {
  printStep(ui, 1, TOTAL_STEPS, 'What is an Invoice?');
  printExplanation(ui, [
    'An ILN invoice represents a payment agreement between a freelancer (you)',
    'and a payer. Once submitted on-chain, a liquidity provider can fund it',
    'early — giving you immediate payment minus a small discount rate.',
    '',
    "Lifecycle: Pending → Funded → Paid (or Defaulted if the payer doesn't pay).",
  ]);

  const answer = (await ask("  Type 'next' to continue or 'skip' to skip this step: ")).trim();
  return answer.toLowerCase() !== 'skip';
}

async function stepExplainNetwork(ask: Asker, ui: Ui, config: ResolvedConfig): Promise<boolean> {
  printStep(ui, 2, TOTAL_STEPS, 'Network & Contract');
  printExplanation(ui, [
    `You're connected to: ${config.network}`,
    `Contract ID:         ${config.contractId}`,
    '',
    'All transactions are submitted to the Stellar Soroban smart contract above.',
    'On testnet, transactions are free. On mainnet, small XLM fees apply.',
  ]);

  const answer = (await ask("  Type 'next' to continue or 'skip' to skip this step: ")).trim();
  return answer.toLowerCase() !== 'skip';
}

async function stepEnterPayer(ask: Asker, ui: Ui, saved?: string): Promise<string | null> {
  printStep(ui, 3, TOTAL_STEPS, 'Payer Address');
  printExplanation(ui, [
    'The payer is the Stellar account that owes you money.',
    'They must mark the invoice as paid once they settle with you off-chain.',
    '',
    'Example: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
  ]);

  if (saved) {
    ui.info(`  (Resuming — saved value: ${pc.cyan(saved)})`);
    const use = (await ask(pc.bold(`  Use saved payer address? [Y/n] `))).trim().toLowerCase();
    if (use !== 'n') return saved;
  }

  const value = await askValidated(
    ask,
    ui,
    "  Payer Stellar address (or 'skip' to exit): ",
    validateStellarAddress
  );
  return value === 'skip' ? null : value;
}

async function stepEnterAmount(ask: Asker, ui: Ui, saved?: string): Promise<string | null> {
  printStep(ui, 4, TOTAL_STEPS, 'Invoice Amount');
  printExplanation(ui, [
    'Enter the invoice amount in display units (e.g. 100 for 100 USDC).',
    'The protocol uses 7 decimal places internally (1 USDC = 10,000,000 stroops).',
    '',
    'Example: 250.50',
  ]);

  if (saved) {
    const use = (await ask(pc.bold(`  Use saved amount (${pc.cyan(saved)})? [Y/n] `)))
      .trim()
      .toLowerCase();
    if (use !== 'n') return saved;
  }

  const value = await askValidated(
    ask,
    ui,
    "  Invoice amount (or 'skip' to exit): ",
    validateAmount
  );
  return value === 'skip' ? null : value;
}

async function stepEnterDueDate(ask: Asker, ui: Ui, saved?: string): Promise<string | null> {
  printStep(ui, 5, TOTAL_STEPS, 'Due Date');
  printExplanation(ui, [
    'When is this invoice due? Use YYYY-MM-DD format or a Unix timestamp.',
    'This is when the payer is expected to settle the invoice.',
    '',
    'Example: 2026-12-31',
  ]);

  if (saved) {
    const use = (await ask(pc.bold(`  Use saved due date (${pc.cyan(saved)})? [Y/n] `)))
      .trim()
      .toLowerCase();
    if (use !== 'n') return saved;
  }

  const value = await askValidated(ask, ui, "  Due date (or 'skip' to exit): ", validateDueDate);
  return value === 'skip' ? null : value;
}

async function stepEnterRate(ask: Asker, ui: Ui, saved?: string): Promise<string | null> {
  printStep(ui, 6, TOTAL_STEPS, 'Discount Rate');
  printExplanation(ui, [
    'The discount rate (in basis points) is the fee a liquidity provider',
    'takes for funding your invoice early. 100 bps = 1%.',
    '',
    'A higher rate makes funding more attractive but reduces your payout.',
    'Example: 300 (= 3%)',
  ]);

  if (saved) {
    const use = (await ask(pc.bold(`  Use saved rate (${pc.cyan(saved)} bps)? [Y/n] `)))
      .trim()
      .toLowerCase();
    if (use !== 'n') return saved;
  }

  const value = await askValidated(
    ask,
    ui,
    "  Discount rate in basis points (or 'skip' to exit): ",
    validateBasisPoints
  );
  return value === 'skip' ? null : value;
}

async function stepConfirmAndSubmit(
  ask: Asker,
  client: ILNClient,
  config: ResolvedConfig,
  ui: Ui,
  inputs: InvoiceInputs
): Promise<boolean> {
  printStep(ui, 7, TOTAL_STEPS, 'Review & Submit');

  ui.info(pc.bold('  Please review your invoice:\n'));
  ui.info(`    ${pc.cyan('Payer    ')} ${inputs.payer}`);
  ui.info(`    ${pc.cyan('Amount   ')} ${inputs.amount}`);
  ui.info(`    ${pc.cyan('Due Date ')} ${inputs.dueDate}`);
  ui.info(`    ${pc.cyan('Rate     ')} ${inputs.rate} bps`);
  ui.info(`    ${pc.cyan('Network  ')} ${config.network}`);
  ui.info('');

  const confirm = (await ask(pc.bold('  Submit this invoice? [Y/n] '))).trim().toLowerCase();

  if (confirm === 'n') {
    ui.warn('  Submission cancelled. Your inputs have been saved — run `iln tutorial` to resume.');
    return false;
  }

  const tokenId = config.tokenId;
  if (!tokenId) {
    ui.error(
      '  Token ID is not configured. Set `contractIds.token` in your config or `ILN_TOKEN_ID`.'
    );
    return false;
  }

  ui.info(pc.cyan('\n  Submitting your invoice to the Stellar network...'));

  try {
    const { invoiceId, txHash } = await client.submitInvoice({
      amount: parseDisplayAmount(inputs.amount),
      discountRate: Number(inputs.rate),
      dueDate: parseDueDate(inputs.dueDate),
      payer: inputs.payer,
      tokenId,
    });

    ui.info('');
    ui.info(pc.bold(pc.green('  Invoice submitted successfully!')));
    ui.info(`  Invoice ID : ${pc.bold(invoiceId.toString())}`);
    ui.info(`  Tx Hash    : ${pc.cyan(txHash)}`);
    ui.info('');
    ui.info(pc.dim('  Next steps:'));
    ui.info(pc.dim(`    iln status --id ${invoiceId}   # Check invoice state`));
    ui.info(pc.dim(`    iln list --address <your-address>  # List your invoices`));
    return true;
  } catch (err) {
    ui.error(`  Submission failed: ${err instanceof Error ? err.message : String(err)}`);
    ui.info('  Your inputs have been saved. Run `iln tutorial` to try again.');
    return false;
  }
}

// ── Main entry ────────────────────────────────────────────────────────────

/**
 * Run the interactive CLI tutorial.
 * Guides the user step-by-step through submitting their first invoice.
 */
export async function runTutorial(deps: TutorialDependencies): Promise<void> {
  const { client, config, ui } = deps;

  const rl = createInterface({
    input: deps.input ?? process.stdin,
    output: deps.output ?? process.stdout,
    terminal: false,
  });

  const ask = makeAsker(rl);

  const existing = loadProgress();
  const resumed = existing !== null && !existing.completedAt;

  const progress: TutorialProgress = existing ?? {
    completedSteps: [],
    savedInputs: {},
    startedAt: new Date().toISOString(),
  };

  const complete = (step: StepId): void => {
    if (!progress.completedSteps.includes(step)) {
      progress.completedSteps.push(step);
      saveProgress(progress);
    }
  };

  try {
    // Welcome
    const proceed = await stepWelcome(ask, ui, resumed);
    if (!proceed) {
      ui.info('\nTutorial exited. Run `iln tutorial` to restart.');
      return;
    }
    complete('welcome');

    // Step 1 — explain invoice
    const continueAfterInvoiceExplain = await stepExplainInvoice(ask, ui);
    if (!continueAfterInvoiceExplain) {
      ui.info('\nTutorial skipped. Run `iln tutorial` to restart from the beginning.');
      clearProgress();
      return;
    }
    complete('explain-invoice');

    // Step 2 — explain network
    const continueAfterNetworkExplain = await stepExplainNetwork(ask, ui, config);
    if (!continueAfterNetworkExplain) {
      ui.info('\nTutorial skipped. Run `iln tutorial` to restart from the beginning.');
      clearProgress();
      return;
    }
    complete('explain-network');

    // Step 3 — payer
    const payer = await stepEnterPayer(ask, ui, progress.savedInputs.payer);
    if (!payer) {
      saveProgress(progress);
      ui.info('\nTutorial paused. Run `iln tutorial` to resume.');
      return;
    }
    progress.savedInputs.payer = payer;
    complete('enter-payer');
    saveProgress(progress);

    // Step 4 — amount
    const amount = await stepEnterAmount(ask, ui, progress.savedInputs.amount);
    if (!amount) {
      saveProgress(progress);
      ui.info('\nTutorial paused. Run `iln tutorial` to resume.');
      return;
    }
    progress.savedInputs.amount = amount;
    complete('enter-amount');
    saveProgress(progress);

    // Step 5 — due date
    const dueDate = await stepEnterDueDate(ask, ui, progress.savedInputs.dueDate);
    if (!dueDate) {
      saveProgress(progress);
      ui.info('\nTutorial paused. Run `iln tutorial` to resume.');
      return;
    }
    progress.savedInputs.dueDate = dueDate;
    complete('enter-due-date');
    saveProgress(progress);

    // Step 6 — rate
    const rate = await stepEnterRate(ask, ui, progress.savedInputs.rate);
    if (!rate) {
      saveProgress(progress);
      ui.info('\nTutorial paused. Run `iln tutorial` to resume.');
      return;
    }
    progress.savedInputs.rate = rate;
    complete('enter-rate');
    saveProgress(progress);

    // Step 7 — confirm & submit
    const submitted = await stepConfirmAndSubmit(ask, client, config, ui, {
      payer,
      amount,
      dueDate,
      rate,
    });

    if (submitted) {
      progress.completedAt = new Date().toISOString();
      complete('done');
      clearProgress();

      printDivider(ui);
      ui.info(pc.bold("\n  Tutorial complete! You're ready to use the ILN CLI.\n"));
      ui.info(pc.dim('  Useful commands:'));
      ui.info(pc.dim('    iln status --id <id>       Check an invoice'));
      ui.info(pc.dim('    iln list --address <G>     List your invoices'));
      ui.info(pc.dim('    iln interactive            Full interactive mode'));
      ui.info(pc.dim('    iln --help                 All available commands'));
      ui.info('');
    }
  } finally {
    rl.close();
  }
}
