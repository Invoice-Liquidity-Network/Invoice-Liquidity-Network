import {
  Account,
  Address,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { CONFIG } from './config';
import type { Invoice } from './types';

// ─── Singleton RPC server ─────────────────────────────────────────────────────

export const server = new rpc.Server(CONFIG.rpcUrl, {
  allowHttp: CONFIG.rpcUrl.startsWith('http://'),
});

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Well-known Stellar account used for read-only simulations.
 * It has sequence 0 on every network and never needs to actually exist on-chain
 * for simulation purposes.
 */
const DUMMY_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

// ─── Contract reader ──────────────────────────────────────────────────────────

/**
 * Fetch full invoice state from the Soroban RPC by calling `get_invoice(id)`.
 * Returns null if the invoice does not exist or the RPC call fails.
 */
export async function fetchInvoice(
  id: number
): Promise<Omit<Invoice, 'created_at' | 'updated_at'> | null> {
  try {
    const account = new Account(DUMMY_ACCOUNT, '0');

    const tx = new TransactionBuilder(account, {
      fee: '1000',
      networkPassphrase: CONFIG.networkPassphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(CONFIG.contractId).toScAddress(),
              functionName: 'get_invoice',
              args: [nativeToScVal(BigInt(id), { type: 'u64' })],
            })
          ),
          auth: [],
        })
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);

    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      return null;
    }

    const native = scValToNative(sim.result.retval) as Record<string, unknown>;

    return {
      id,
      freelancer: Address.fromScAddress(native.freelancer as xdr.ScAddress).toString(),
      payer: Address.fromScAddress(native.payer as xdr.ScAddress).toString(),
      amount: String(native.amount),
      due_date: Number(native.due_date),
      discount_rate: Number(native.discount_rate),
      status: parseStatus(native.status),
      funder: native.funder
        ? Address.fromScAddress(native.funder as xdr.ScAddress).toString()
        : null,
      funded_at: native.funded_at ? Number(native.funded_at) : null,
    };
  } catch (err) {
    console.error(`[rpc] Failed to fetch invoice ${id}:`, err);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStatus(raw: unknown): Invoice['status'] {
  const key = Object.keys(raw as object)[0];
  if (key === 'Funded') return 'Funded';
  if (key === 'Paid') return 'Paid';
  if (key === 'Defaulted') return 'Defaulted';
  return 'Pending';
}
