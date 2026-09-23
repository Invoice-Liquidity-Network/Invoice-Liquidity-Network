import {
  rpc as SorobanRpc,
  nativeToScVal,
  scValToNative,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Contract,
  Address,
  xdr as stellarXdr,
} from '@stellar/stellar-sdk';

/**
 * Reputation score for an address on the Invoice Liquidity Network.
 *
 * Returned by {@link ReputationClient.getReputation} and
 * {@link ReputationClient.getTopPayers}.
 *
 * Intentionally differs from @iln/shared's ReputationScore: this SDK version
 * includes client-computed fields (`totalPaid`, `invoiceCount`, `lastActivity`,
 * `rank`) that are derived from the contract data but not part of the on-chain
 * struct. The shared version uses `invoicesSubmitted`/`invoicesPaid`/`invoicesDefaulted`
 * and `lastActivityLedger` which are the raw contract fields.
 */
export interface ReputationScore {
  /** Stellar public address (G...) or contract address (C...). */
  address: string;
  /** Overall reputation score (0–100). */
  score: number;
  /** Total amount paid in base units (stroops). */
  totalPaid: bigint;
  /** Number of invoices the address has paid. */
  invoiceCount: number;
  /** Unix timestamp of the most recent activity. */
  lastActivity: number;
  /** Position in the global payer ranking (1-indexed). */
  rank: number;
}

function zeroReputationScore(address: string): ReputationScore {
  return { address, score: 0, totalPaid: 0n, invoiceCount: 0, lastActivity: 0, rank: 0 };
}

function parseReputationScore(native: unknown, address: string): ReputationScore {
  if (!native || typeof native !== 'object') {
    return zeroReputationScore(address);
  }

  let get: (key: string) => unknown;

  if (native instanceof Map) {
    get = (key: string) => (native as Map<string, unknown>).get(key);
  } else {
    get = (key: string) => (native as Record<string, unknown>)[key];
  }

  return {
    address,
    score: Math.max(0, Number(get('score') ?? 0)) || 0,
    totalPaid: BigInt(String(get('total_paid') ?? '0')) || 0n,
    invoiceCount: Math.max(0, Number(get('invoice_count') ?? 0)) || 0,
    lastActivity: Math.max(0, Number(get('last_activity') ?? 0)) || 0,
    rank: Math.max(0, Number(get('rank') ?? 0)) || 0,
  };
}

/**
 * Client for querying on-chain reputation data from the Invoice Liquidity Network.
 *
 * Provides type-safe access to the ILN reputation contract without exposing raw XDR.
 * All contract return values are parsed into clean {@link ReputationScore} structs.
 *
 * @example
 * ```ts
 * import { ReputationClient } from '@iln/sdk';
 *
 * const client = new ReputationClient(
 *   'https://soroban-testnet.stellar.org',
 *   'CA3D...',
 * );
 *
 * const rep = await client.getReputation('GB...');
 * console.log(rep.score); // 85
 *
 * const top = await client.getTopPayers(10);
 * console.log(top.length); // 10
 * ```
 */
export class ReputationClient {
  private server: SorobanRpc.Server;
  private contractId: string;
  private networkPassphrase: string;
  private source: string;

  /**
   * @param rpcUrl - Soroban RPC endpoint (e.g. `https://soroban-testnet.stellar.org`).
   * @param contractId - The deployed reputation contract ID (C... address).
   * @param options - Optional configuration.
   * @param options.networkPassphrase - Network passphrase (defaults to `Networks.TESTNET`).
   * @param options.source - Source account public key for simulation. If omitted, a random keypair is used (suitable for read-only queries where the simulation does not require a funded account).
   */
  constructor(
    rpcUrl: string,
    contractId: string,
    options?: { networkPassphrase?: string; source?: string }
  ) {
    this.server = new SorobanRpc.Server(rpcUrl);
    this.contractId = contractId;
    this.networkPassphrase = options?.networkPassphrase ?? Networks.TESTNET;
    this.source = options?.source ?? Keypair.random().publicKey();
  }

  /**
   * Returns the full reputation profile for a Stellar address.
   *
   * If the address has no on-chain history, a zeroed {@link ReputationScore}
   * is returned instead of throwing.
   *
   * @param address - Stellar public key (G...) or contract address (C...).
   *
   * @example
   * ```ts
   * const rep = await client.getReputation('GABCDEF123...');
   * // { address: 'GABCDEF123...', score: 75, totalPaid: 5000000000n, ... }
   * ```
   */
  async getReputation(address: string): Promise<ReputationScore> {
    try {
      const addressScVal = new Address(address).toScVal();
      const retval = await this.simulate('get_reputation', [addressScVal]);
      const native = scValToNative(retval);
      return parseReputationScore(native, address);
    } catch {
      return zeroReputationScore(address);
    }
  }

  /**
   * Returns the top payers ranked by reputation score.
   *
   * @param limit - Maximum number of payers to return (max 100).
   *
   * @example
   * ```ts
   * const top = await client.getTopPayers(5);
   * top.forEach((p, i) => console.log(`#${i + 1}: ${p.address} (${p.score})`));
   * ```
   */
  async getTopPayers(limit: number): Promise<ReputationScore[]> {
    const limitScVal = nativeToScVal(limit, { type: 'u32' });
    const retval = await this.simulate('get_top_payers', [limitScVal]);
    const native = scValToNative(retval);

    if (!Array.isArray(native)) {
      return [];
    }

    return native.map((entry: unknown) => {
      if (entry && typeof entry === 'object') {
        const get = (key: string) =>
          entry instanceof Map ? entry.get(key) : (entry as Record<string, unknown>)[key];
        const addr = String(get('address') ?? '');
        return parseReputationScore(entry, addr);
      }
      return zeroReputationScore('');
    });
  }

  /**
   * Convenience method that returns only the reputation score for an address.
   *
   * Equivalent to `(await client.getReputation(address)).score`.
   *
   * @param address - Stellar public key or contract address.
   *
   * @example
   * ```ts
   * const score = await client.getReputationScore('GABCDEF123...');
   * if (score > 80) console.log('Highly trusted payer');
   * ```
   */
  async getReputationScore(address: string): Promise<number> {
    const rep = await this.getReputation(address);
    return rep.score;
  }

  private async simulate(method: string, args: stellarXdr.ScVal[]): Promise<stellarXdr.ScVal> {
    const contract = new Contract(this.contractId);
    const account = await this.server.getAccount(this.source);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const response = await this.server.simulateTransaction(tx);

    if ('error' in response) {
      throw new Error(response.error);
    }
    if (!response.result?.retval) {
      throw new Error('No return value');
    }
    return response.result.retval;
  }
}
