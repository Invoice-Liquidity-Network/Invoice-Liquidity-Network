import { TransactionBuilder, Networks, Transaction } from '@stellar/stellar-sdk';
import { SimulationError } from './errors.js';

// Derived from TransactionBuilder's own method signature (rather than the
// standalone `Operation` type) to avoid nominal type mismatches when
// multiple @stellar/stellar-base versions are present in the workspace.
type TxOperation = Parameters<TransactionBuilder['addOperation']>[0];

export interface TransactionConfig {
  baseFee?: number;
  maxFee?: number;
  timeout?: number;
  networkPassphrase?: string;
  sourceAccount: string;
}

export interface SimulationResult {
  success: boolean;
  fee: number;
  resources: {
    cpu: number;
    memory: number;
    readBytes: number;
    writeBytes: number;
  };
  minResourceFee: number;
  error?: string;
  cached?: boolean;
}

export interface SimulationCacheOptions {
  maxAge?: number;
  maxSize?: number;
}

interface CacheEntry {
  result: SimulationResult;
  timestamp: number;
}

class SimulationCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxAge: number;
  private maxSize: number;

  constructor(options?: SimulationCacheOptions) {
    this.maxAge = options?.maxAge ?? 30_000;
    this.maxSize = options?.maxSize ?? 50;
  }

  get(key: string): SimulationResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }

    return { ...entry.result, cached: true };
  }

  set(key: string, result: SimulationResult): void {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { result, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export interface RpcClient {
  getAccount(address: string): Promise<any>;
  simulateTransaction(tx: Transaction): Promise<any>;
}

export class ILNTransactionBuilder {
  private rpcClient: RpcClient;
  private cache: SimulationCache;

  constructor(rpcClient: RpcClient, cacheOptions?: SimulationCacheOptions) {
    this.rpcClient = rpcClient;
    this.cache = new SimulationCache(cacheOptions);
  }

  async buildTransaction(
    operations: TxOperation[],
    config: TransactionConfig
  ): Promise<{
    transaction: Transaction;
    simulation: SimulationResult;
  }> {
    const {
      baseFee = 100,
      maxFee = 1000,
      timeout = 30,
      networkPassphrase = Networks.TESTNET,
      sourceAccount,
    } = config;

    const account = await this.rpcClient.getAccount(sourceAccount);

    const txBuilder = new TransactionBuilder(account, {
      fee: baseFee.toString(),
      networkPassphrase,
    });

    operations.forEach((op) => txBuilder.addOperation(op));
    txBuilder.setTimeout(timeout);

    let transaction = txBuilder.build();

    const simulation = await this.simulateWithCache(transaction);

    if (simulation.success) {
      const adjustedFee = Math.min(Math.max(baseFee, simulation.minResourceFee), maxFee);
      transaction = TransactionBuilder.cloneFrom(transaction, {
        fee: adjustedFee.toString(),
        networkPassphrase,
      }).build();
    }

    return { transaction, simulation };
  }

  async simulateWithCache(tx: Transaction): Promise<SimulationResult> {
    const cacheKey = this.getCacheKey(tx);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const result = await this.simulateTransaction(tx);
    if (result.success) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  async estimateCost(
    operations: TxOperation[],
    config: TransactionConfig
  ): Promise<{
    baseFee: number;
    estimatedFee: number;
    resources: SimulationResult['resources'];
    withinBudget: boolean;
  }> {
    const baseFee = config.baseFee ?? 100;
    const maxFee = config.maxFee ?? 1000;

    const { simulation } = await this.buildTransaction(operations, config);

    return {
      baseFee,
      estimatedFee: simulation.minResourceFee,
      resources: simulation.resources,
      withinBudget: simulation.minResourceFee <= maxFee,
    };
  }

  async forceSubmit(
    operations: TxOperation[],
    config: TransactionConfig
  ): Promise<{
    transaction: Transaction;
    simulation: SimulationResult;
  }> {
    const {
      baseFee = 100,
      timeout = 30,
      networkPassphrase = Networks.TESTNET,
      sourceAccount,
    } = config;

    const account = await this.rpcClient.getAccount(sourceAccount);

    const txBuilder = new TransactionBuilder(account, {
      fee: baseFee.toString(),
      networkPassphrase,
    });

    operations.forEach((op) => txBuilder.addOperation(op));
    txBuilder.setTimeout(timeout);

    const transaction = txBuilder.build();

    const simulation = await this.simulateTransaction(transaction);

    if (!simulation.success) {
      throw new SimulationError(
        `Transaction simulation failed: ${simulation.error ?? 'Unknown error'}. ` +
          `Use forceSubmit to bypass simulation checks.`,
        'Review transaction parameters or use forceSubmit to skip simulation.'
      );
    }

    return { transaction, simulation };
  }

  validateBeforeSubmit(simulation: SimulationResult): void {
    if (!simulation.success) {
      throw new SimulationError(
        `Transaction would fail: ${simulation.error ?? 'Simulation indicated failure'}. ` +
          `Fix the issue before submitting.`,
        'Check transaction parameters, account balances, and contract state.'
      );
    }
  }

  private async simulateTransaction(tx: Transaction): Promise<SimulationResult> {
    try {
      const result = await this.rpcClient.simulateTransaction(tx);

      return {
        success: result.success,
        fee: result.fee || 0,
        resources: {
          cpu: result.resources?.cpu || 0,
          memory: result.resources?.memory || 0,
          readBytes: result.resources?.readBytes || 0,
          writeBytes: result.resources?.writeBytes || 0,
        },
        minResourceFee: result.minResourceFee || 100,
      };
    } catch (error: any) {
      return {
        success: false,
        fee: 0,
        resources: { cpu: 0, memory: 0, readBytes: 0, writeBytes: 0 },
        minResourceFee: 100,
        error: error.message,
      };
    }
  }

  private getCacheKey(tx: Transaction): string {
    return tx.toXDR();
  }

  clearCache(): void {
    this.cache.clear();
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}
