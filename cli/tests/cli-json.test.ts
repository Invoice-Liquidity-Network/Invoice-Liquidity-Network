import { Writable } from 'stream';
import { Keypair } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli, type CliDependencies } from '../src/cli';
import type { ILNClient } from '../src/client';

const testAddress = Keypair.random().publicKey();

function createStreamCapture() {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });

  return {
    stream,
    getOutput: () => output,
  };
}

describe('CLI --json output consistency', () => {
  let stdout: ReturnType<typeof createStreamCapture>;
  let stderr: ReturnType<typeof createStreamCapture>;
  let dependencies: Partial<CliDependencies>;

  beforeEach(() => {
    stdout = createStreamCapture();
    stderr = createStreamCapture();

    const client = {
      getInvoice: vi.fn().mockResolvedValue({
        id: 42n,
        status: 'Pending',
        amount: 100n,
        amountFunded: 0n,
        discountRate: 500,
        dueDate: 1735689600,
        freelancer: testAddress,
        payer: testAddress,
        funder: null,
        token: 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        fundedAt: null,
      }),
      listInvoicesByAddress: vi.fn().mockResolvedValue([]),
    } as unknown as ILNClient;

    dependencies = {
      stdout: stdout.stream,
      stderr: stderr.stream,
      loadConfig: vi.fn().mockReturnValue({
        network: 'testnet',
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: 'http://localhost:8000',
        contractId: 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        keypairPath: '.iln/keypair.txt',
      }),
      createClient: vi.fn().mockReturnValue(client),
    };
  });

  it('wraps status output in the shared success envelope', async () => {
    const exitCode = await runCli(['--json', 'status', '--id', '42'], dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.getOutput())).toMatchObject({
      success: true,
      data: { id: '42', status: 'Pending' },
    });
  });

  it('wraps list output in the shared success envelope', async () => {
    const exitCode = await runCli(['--json', 'list', '--address', testAddress], dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.getOutput())).toEqual({ success: true, data: [] });
  });
});
