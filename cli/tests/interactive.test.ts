/**
 * Tests for CLI interactive mode (#444)
 *
 * Strategy: inject a scripted Readable stream as stdin so the interactive
 * runner consumes our pre-written answers without blocking on a real TTY.
 * We capture stdout/stderr using memory streams.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { runInteractive } from '../src/interactive';
import type { InteractiveDependencies } from '../src/interactive';
import type { ResolvedConfig } from '../src/types';

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_ADDRESS = Keypair.random().publicKey();
const VALID_ADDRESS_B = Keypair.random().publicKey();

const BASE_CONFIG: ResolvedConfig = {
  contractId: Keypair.random().publicKey(),
  keypairPath: '/tmp/test.secret',
  network: 'testnet',
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  tokenId: Keypair.random().publicKey(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function memStream(): Writable & { text(): string } {
  let buf = '';
  return Object.assign(
    new Writable({
      write(chunk, _enc, cb) {
        buf += chunk.toString();
        cb();
      },
    }),
    { text: () => buf }
  );
}

/**
 * Build a Readable stream that emits newline-terminated lines one at a time.
 * This simulates a user typing answers and pressing Enter.
 */
function scriptedInput(lines: string[]): Readable {
  return Readable.from(lines.map((l) => `${l}\n`).join(''));
}

function makeUi(stdout: Writable, stderr: Writable) {
  return {
    error: (m: string) => stderr.write(`error ${m}\n`),
    info: (m: string) => stdout.write(`${m}\n`),
    success: (m: string) => stdout.write(`success ${m}\n`),
    warn: (m: string) => stderr.write(`warn ${m}\n`),
  };
}

function makeDeps(
  lines: string[],
  client: Partial<InteractiveDependencies['client']> = {},
  config: ResolvedConfig = BASE_CONFIG
): {
  deps: InteractiveDependencies;
  out: ReturnType<typeof memStream>;
  err: ReturnType<typeof memStream>;
} {
  const out = memStream();
  const err = memStream();
  const deps: InteractiveDependencies = {
    client: client as InteractiveDependencies['client'],
    config,
    ui: makeUi(out, err),
    input: scriptedInput(lines),
    output: out,
  };
  return { deps, out, err };
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

describe('interactive menu', () => {
  it('prints the menu and exits when user chooses 0', async () => {
    const { deps, out } = makeDeps(['0']);

    await runInteractive(deps);

    expect(out.text()).toContain('Submit invoice');
    expect(out.text()).toContain('Exit');
    expect(out.text()).toContain('Goodbye');
  });

  it('warns on invalid menu choice and re-prompts', async () => {
    // First two entries are invalid, third is "exit"
    const { deps, err, out } = makeDeps(['9', 'abc', '0']);

    await runInteractive(deps);

    expect(err.text()).toContain('Invalid choice');
    expect(out.text()).toContain('Goodbye');
  });
});

// ─── Submit invoice ───────────────────────────────────────────────────────────

describe('submit invoice flow', () => {
  it('submits an invoice and shows success', async () => {
    const submitInvoice = vi.fn().mockResolvedValue({ invoiceId: 7n, txHash: 'txABC' });

    const { deps, out } = makeDeps(
      [
        '1', // choose submit
        VALID_ADDRESS, // payer address
        '100', // amount
        '2026-12-31', // due date
        '300', // rate bps
        'Y', // confirm
        '0', // exit
      ],
      { submitInvoice }
    );

    await runInteractive(deps);

    expect(submitInvoice).toHaveBeenCalledOnce();
    expect(submitInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        payer: VALID_ADDRESS,
        discountRate: 300,
      })
    );
    expect(out.text()).toContain('7');
    expect(out.text()).toContain('txABC');
  });

  it('cancels submit when user answers N to confirmation', async () => {
    const submitInvoice = vi.fn();

    const { deps, out } = makeDeps(
      [
        '1',
        VALID_ADDRESS,
        '50',
        '2026-12-31',
        '100',
        'n', // cancel
        '0',
      ],
      { submitInvoice }
    );

    await runInteractive(deps);

    expect(submitInvoice).not.toHaveBeenCalled();
    expect(out.text()).not.toContain('txABC');
  });

  it('re-prompts when payer address is invalid', async () => {
    const submitInvoice = vi.fn().mockResolvedValue({ invoiceId: 1n, txHash: 'txX' });

    const { deps, err, out } = makeDeps(
      [
        '1',
        'not-a-valid-address', // invalid — should re-prompt
        VALID_ADDRESS, // now valid
        '100',
        '2026-12-31',
        '300',
        'Y',
        '0',
      ],
      { submitInvoice }
    );

    await runInteractive(deps);

    expect(err.text()).toContain('Invalid Stellar address');
    expect(submitInvoice).toHaveBeenCalledOnce();
    expect(out.text()).toContain('success');
  });

  it('re-prompts when amount is invalid', async () => {
    const submitInvoice = vi.fn().mockResolvedValue({ invoiceId: 1n, txHash: 'txY' });

    const { deps, err } = makeDeps(
      [
        '1',
        VALID_ADDRESS,
        'abc', // invalid
        '100', // valid retry
        '2026-12-31',
        '300',
        'Y',
        '0',
      ],
      { submitInvoice }
    );

    await runInteractive(deps);

    expect(err.text()).toContain('Invalid amount');
    expect(submitInvoice).toHaveBeenCalledOnce();
  });

  it('re-prompts when due date is invalid', async () => {
    const submitInvoice = vi.fn().mockResolvedValue({ invoiceId: 1n, txHash: 'txZ' });

    const { deps, err } = makeDeps(
      [
        '1',
        VALID_ADDRESS,
        '100',
        'not-a-date', // invalid
        '2026-12-31', // valid
        '300',
        'Y',
        '0',
      ],
      { submitInvoice }
    );

    await runInteractive(deps);

    expect(err.text()).toContain('Invalid date');
    expect(submitInvoice).toHaveBeenCalledOnce();
  });

  it('shows an error and continues when submit throws', async () => {
    const submitInvoice = vi.fn().mockRejectedValue(new Error('Simulation failed'));

    const { deps, err, out } = makeDeps(
      [
        '1',
        VALID_ADDRESS,
        '100',
        '2026-12-31',
        '300',
        'Y',
        'Y', // continue after error
        '0',
      ],
      { submitInvoice }
    );

    await runInteractive(deps);

    expect(err.text()).toContain('Simulation failed');
    expect(out.text()).toContain('Goodbye');
  });

  it('exits when user answers N to continue-after-error', async () => {
    const submitInvoice = vi.fn().mockRejectedValue(new Error('Network error'));

    const { deps, out } = makeDeps(
      [
        '1',
        VALID_ADDRESS,
        '100',
        '2026-12-31',
        '300',
        'Y',
        'n', // exit after error
      ],
      { submitInvoice }
    );

    await runInteractive(deps);

    expect(out.text()).toContain('Goodbye');
  });
});

// ─── Fund invoice ─────────────────────────────────────────────────────────────

describe('fund invoice flow', () => {
  it('funds an invoice with a specific amount', async () => {
    const fundInvoice = vi.fn().mockResolvedValue({ hash: 'fundTx' });

    const { deps, out } = makeDeps(['2', '42', '50', 'Y', '0'], { fundInvoice });

    await runInteractive(deps);

    expect(fundInvoice).toHaveBeenCalledWith(42n, expect.any(BigInt));
    expect(out.text()).toContain('fundTx');
  });

  it('funds an invoice with full balance when amount is blank', async () => {
    const fundInvoice = vi.fn().mockResolvedValue({ hash: 'fundTxFull' });

    const { deps, out } = makeDeps(
      ['2', '42', '', 'Y', '0'], // blank amount → full balance
      { fundInvoice }
    );

    await runInteractive(deps);

    expect(fundInvoice).toHaveBeenCalledWith(42n, undefined);
    expect(out.text()).toContain('fundTxFull');
  });

  it('cancels funding when user answers N', async () => {
    const fundInvoice = vi.fn();

    const { deps } = makeDeps(['2', '42', '50', 'n', '0'], { fundInvoice });

    await runInteractive(deps);

    expect(fundInvoice).not.toHaveBeenCalled();
  });
});

// ─── Mark paid ────────────────────────────────────────────────────────────────

describe('mark invoice as paid flow', () => {
  it('marks an invoice as paid', async () => {
    const markPaid = vi.fn().mockResolvedValue({ hash: 'paidTx' });

    const { deps, out } = makeDeps(['3', '7', 'Y', '0'], { markPaid });

    await runInteractive(deps);

    expect(markPaid).toHaveBeenCalledWith(7n);
    expect(out.text()).toContain('paidTx');
  });

  it('re-prompts when invoice ID is invalid', async () => {
    const markPaid = vi.fn().mockResolvedValue({ hash: 'paidTx2' });

    const { deps, err } = makeDeps(['3', 'abc', '5', 'Y', '0'], { markPaid });

    await runInteractive(deps);

    expect(err.text()).toContain('Invalid invoice ID');
    expect(markPaid).toHaveBeenCalledWith(5n);
  });
});

// ─── Status check ─────────────────────────────────────────────────────────────

describe('check invoice status flow', () => {
  it('fetches and displays invoice details', async () => {
    const getInvoice = vi.fn().mockResolvedValue({
      id: 10n,
      status: 'Funded',
      amount: 1_000_000_000n,
      amountFunded: 1_000_000_000n,
      discountRate: 300,
      dueDate: 1_800_000_000,
      freelancer: VALID_ADDRESS,
      payer: VALID_ADDRESS_B,
      funder: null,
      fundedAt: null,
      token: 'CTOKEN',
    });

    const { deps, out } = makeDeps(['4', '10', '0'], { getInvoice });

    await runInteractive(deps);

    expect(getInvoice).toHaveBeenCalledWith(10n);
    expect(out.text()).toContain('Funded');
  });
});

// ─── List invoices ────────────────────────────────────────────────────────────

describe('list invoices flow', () => {
  it('lists invoices for a given address', async () => {
    const listInvoicesByAddress = vi.fn().mockResolvedValue([]);

    const { deps, out } = makeDeps(['5', VALID_ADDRESS, '0'], { listInvoicesByAddress });

    await runInteractive(deps);

    expect(listInvoicesByAddress).toHaveBeenCalledWith(VALID_ADDRESS);
    expect(out.text()).toContain('No invoices found');
  });
});

// ─── Progress indicator ───────────────────────────────────────────────────────

describe('progress indicator', () => {
  it('shows a spinner message during transaction submission', async () => {
    const submitInvoice = vi.fn().mockResolvedValue({ invoiceId: 1n, txHash: 'spinTx' });

    const { deps, out } = makeDeps(['1', VALID_ADDRESS, '100', '2026-12-31', '300', 'Y', '0'], {
      submitInvoice,
    });

    await runInteractive(deps);

    // The spinner should have emitted the "Submitting transaction…" message
    expect(out.text()).toContain('Submitting transaction');
  });
});
