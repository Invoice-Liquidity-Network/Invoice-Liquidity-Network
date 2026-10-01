import { describe, expect, it, vi } from 'vitest';

import { rpc } from '@stellar/stellar-sdk';

import { SimulationError } from './errors';
import { preflightMutation } from './simulation';

describe('preflightMutation', () => {
  it('throws SimulationError with the decoded contract error when simulation fails', async () => {
    const server = {
      simulateTransaction: vi.fn().mockResolvedValue({
        error: 'HostError: Error(Contract, #4)',
      }),
    };

    await expect(preflightMutation(server, {})).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof SimulationError &&
        error.message.includes('Contract error') &&
        error.context?.rawError === 'HostError: Error(Contract, #4)'
      );
    });

    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it('assembles the transaction with successful simulation resources', async () => {
    const transaction = { id: 'original' };
    const assembled = { id: 'assembled' };
    const response = {
      transactionData: 'AAAA',
      auth: [],
    };
    const server = {
      simulateTransaction: vi.fn().mockResolvedValue(response),
    };
    const build = vi.fn().mockReturnValue(assembled);
    const assemble = vi
      .spyOn(rpc, 'assembleTransaction')
      .mockReturnValue({ build } as ReturnType<typeof rpc.assembleTransaction>);

    await expect(preflightMutation(server, transaction)).resolves.toBe(assembled);
    expect(assemble).toHaveBeenCalledWith(transaction, response);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('skips simulation when simulate is false', async () => {
    const transaction = { id: 'unchanged' };
    const server = {
      simulateTransaction: vi.fn(),
    };

    await expect(preflightMutation(server, transaction, { simulate: false })).resolves.toBe(
      transaction
    );
    expect(server.simulateTransaction).not.toHaveBeenCalled();
  });
});
