import {
  Account,
  Address,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

import type {
  ClaimDefaultParams,
  FundInvoiceParams,
  ILNSdkConfig,
  Invoice,
  InvoiceStatus,
  MarkPaidParams,
  ProtocolConfig,
  RpcServerLike,
  SubmitInvoiceParams,
  TransactionSigner,
} from "./types";

import { parseContractError } from "./errors";

const READ_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const POLL_ATTEMPTS = 20;
const PROTOCOL_CONFIG_CACHE_MS = 5 * 60 * 1000;

type PreparedTransactionLike = { toXDR(): string };
type BuiltTransaction = ReturnType<TransactionBuilder["build"]>;
type SimulationLike = {
  error?: unknown;
  result?: {
    retval?: xdr.ScVal;
  };
};

export class ILNSdk {
  private readonly contractId: string;
  private readonly networkPassphrase: string;
  private readonly server: RpcServerLike;
  private readonly signer?: TransactionSigner;
  private protocolConfigCache: { expiresAt: number; value: ProtocolConfig } | null = null;

  constructor(config: ILNSdkConfig) {
    this.contractId = config.contractId;
    this.networkPassphrase = config.networkPassphrase;
    this.server = config.server ?? new rpc.Server(config.rpcUrl);
    this.signer = config.signer;
  }

  async submitInvoice(params: SubmitInvoiceParams): Promise<bigint> {
    const signerAddress = await this.requireSignerAddress();

    if (signerAddress !== params.freelancer) {
      throw new Error("submitInvoice must be signed by the freelancer address.");
    }

    const transaction = await this.buildWriteTransaction(params.freelancer, "submit_invoice", [
      this.toAddress(params.freelancer),
      this.toAddress(params.payer),
      nativeToScVal(params.amount, { type: "i128" }),
      nativeToScVal(params.dueDate, { type: "u64" }),
      nativeToScVal(params.discountRate, { type: "u32" }),
    ]);

    const simulation = await this.server.simulateTransaction(transaction);
    const invoiceId = this.extractBigIntResult(simulation, "submit_invoice");
    const preparedTransaction = await this.prepareTransaction(transaction);

    await this.signAndSend(preparedTransaction, params.freelancer);
    return invoiceId;
  }

  async fundInvoice(params: FundInvoiceParams): Promise<void> {
    const signerAddress = await this.requireSignerAddress();

    if (signerAddress !== params.funder) {
      throw new Error("fundInvoice must be signed by the funder address.");
    }

    const transaction = await this.buildWriteTransaction(params.funder, "fund_invoice", [
      this.toAddress(params.funder),
      nativeToScVal(params.invoiceId, { type: "u64" }),
    ]);

    const preparedTransaction = await this.prepareTransaction(transaction);
    await this.signAndSend(preparedTransaction, params.funder);
  }

  async markPaid(params: MarkPaidParams): Promise<void> {
    const payer = await this.requireSignerAddress();
    const transaction = await this.buildWriteTransaction(payer, "mark_paid", [
      nativeToScVal(params.invoiceId, { type: "u64" }),
    ]);
    const preparedTransaction = await this.prepareTransaction(transaction);

    await this.signAndSend(preparedTransaction, payer);
  }

  async claimDefault(params: ClaimDefaultParams): Promise<void> {
    const signerAddress = await this.requireSignerAddress();

    if (signerAddress !== params.funder) {
      throw new Error("claimDefault must be signed by the funder address.");
    }

    const transaction = await this.buildWriteTransaction(params.funder, "claim_default", [
      this.toAddress(params.funder),
      nativeToScVal(params.invoiceId, { type: "u64" }),
    ]);
    const preparedTransaction = await this.prepareTransaction(transaction);

    await this.signAndSend(preparedTransaction, params.funder);
  }

  async getInvoice(invoiceId: bigint): Promise<Invoice> {
    const transaction = this.buildReadTransaction("get_invoice", [
      nativeToScVal(invoiceId, { type: "u64" }),
    ]);
    const simulation = await this.server.simulateTransaction(transaction);

    return this.extractInvoiceResult(simulation);
  }

  /** Fetch reputation score for an address */
  async getReputation(address: string): Promise<number> {
    const transaction = this.buildReadTransaction("get_reputation", [
      this.toAddress(address),
    ]);
    const simulation = await this.server.simulateTransaction(transaction);
    const result = this.extractSimulationRetval(simulation, "get_reputation");
    const native = scValToNative(result) as unknown;
    if (typeof native === "number") return native;
    if (typeof native === "bigint") return Number(native);
    throw new Error("Unexpected reputation result type");
  }

  /** Fetch contract-wide statistics */
  async getStats(): Promise<unknown> {
    const transaction = this.buildReadTransaction("get_stats", []);
    const simulation = await this.server.simulateTransaction(transaction);
    const result = this.extractSimulationRetval(simulation, "get_stats");
    return scValToNative(result);
  }

  /** Fetch governance proposal by id */
  async getProposal(id: bigint): Promise<unknown> {
    const transaction = this.buildReadTransaction("get_proposal", [
      nativeToScVal(id, { type: "u64" }),
    ]);
    const simulation = await this.server.simulateTransaction(transaction);
    const result = this.extractSimulationRetval(simulation, "get_proposal");
    return scValToNative(result);
  }

  async getProtocolConfig(): Promise<ProtocolConfig> {
    const now = Date.now();
    if (this.protocolConfigCache && this.protocolConfigCache.expiresAt > now) {
      return this.protocolConfigCache.value;
    }

    const transaction = this.buildReadTransaction("get_protocol_config", []);
    const simulation = await this.server.simulateTransaction(transaction);
    const result = this.extractSimulationRetval(simulation, "get_protocol_config");
    const config = this.parseProtocolConfig(
      this.unwrapContractResult(scValToNative(result), "get_protocol_config"),
    );

    this.protocolConfigCache = {
      expiresAt: now + PROTOCOL_CONFIG_CACHE_MS,
      value: config,
    };

    return config;
  }

  /** Raw storage key lookup */
  async getStorage(key: string): Promise<string> {
    const transaction = this.buildReadTransaction("get_storage", [
      nativeToScVal(key, { type: "string" }),
    ]);
    const simulation = await this.server.simulateTransaction(transaction);
    const result = this.extractSimulationRetval(simulation, "get_storage");
    const native = scValToNative(result);
    return typeof native === "string" ? native : String(native);
  }

  private buildReadTransaction(method: string, args: xdr.ScVal[]): BuiltTransaction {
    return new TransactionBuilder(new Account(READ_ACCOUNT, "0"), {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: this.contractId,
          function: method,
          args,
        }),
      )
      .setTimeout(30)
      .build();
  }

  private async buildWriteTransaction(
    sourceAddress: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<BuiltTransaction> {
    const sourceAccount = (await this.server.getAccount(sourceAddress)) as Account;

    return new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: this.contractId,
          function: method,
          args,
        }),
      )
      .setTimeout(30)
      .build();
  }

  private async requireSignerAddress(): Promise<string> {
    if (!this.signer) {
      throw new Error("A transaction signer is required for state-changing contract calls.");
    }

    return this.signer.getPublicKey();
  }

  private async prepareTransaction(
    transaction: BuiltTransaction,
  ): Promise<PreparedTransactionLike> {
    try {
      return await this.server.prepareTransaction(transaction);
    } catch (error) {
      throw new Error(`Failed to prepare contract transaction: ${this.toErrorMessage(error)}`);
    }
  }

  private async signAndSend(
    preparedTransaction: PreparedTransactionLike,
    sourceAddress: string,
  ): Promise<void> {
    const signer = this.signer;
    if (!signer) {
      throw new Error("A transaction signer is required for state-changing contract calls.");
    }

    const signedXdr = await signer.signTransaction(preparedTransaction.toXDR(), {
      address: sourceAddress,
      networkPassphrase: this.networkPassphrase,
    });
    const signedTransaction = TransactionBuilder.fromXDR(
      signedXdr,
      this.networkPassphrase,
    );
    const response = (await this.server.sendTransaction(signedTransaction)) as {
      errorResultXdr?: string;
      hash?: string;
      status?: string;
    };

    if (!response.hash || !response.status) {
      throw new Error("RPC server returned an invalid sendTransaction response.");
    }

    if (response.status !== "PENDING" && response.status !== "DUPLICATE") {
      throw new Error(
        `Transaction submission failed with status ${response.status}. ${response.errorResultXdr ?? ""}`.trim(),
      );
    }

    const finalStatus = (await this.server.pollTransaction(response.hash, {
      attempts: POLL_ATTEMPTS,
    })) as {
      resultXdr?: string;
      status?: string;
    };

    if (finalStatus.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(
        `Transaction did not succeed. Final status: ${String(finalStatus.status)}.`,
      );
    }
  }

  private extractBigIntResult(simulation: unknown, method: string): bigint {
    const result = this.extractSimulationRetval(simulation, method);
    return this.toBigInt(this.unwrapContractResult(scValToNative(result), method));
  }

  private extractInvoiceResult(simulation: unknown): Invoice {
    const result = this.extractSimulationRetval(simulation, "get_invoice");
    const nativeInvoice = this.unwrapContractResult(
      scValToNative(result),
      "get_invoice",
    ) as Record<string, unknown>;

    return {
      id: this.toBigInt(nativeInvoice.id),
      freelancer: this.toStringValue(nativeInvoice.freelancer, "freelancer"),
      payer: this.toStringValue(nativeInvoice.payer, "payer"),
      amount: this.toBigInt(nativeInvoice.amount),
      dueDate: this.toNumberValue(
        nativeInvoice.due_date ?? nativeInvoice.dueDate,
        "dueDate",
      ),
      discountRate: this.toNumberValue(
        nativeInvoice.discount_rate ?? nativeInvoice.discountRate,
        "discountRate",
      ),
      status: this.parseStatus(nativeInvoice.status),
      funder: nativeInvoice.funder == null ? null : this.toStringValue(nativeInvoice.funder, "funder"),
      fundedAt:
        nativeInvoice.funded_at == null && nativeInvoice.fundedAt == null
          ? null
          : this.toNumberValue(nativeInvoice.funded_at ?? nativeInvoice.fundedAt, "fundedAt"),
    };
  }

  private parseProtocolConfig(value: unknown): ProtocolConfig {
    if (!value || typeof value !== "object") {
      throw new Error("Contract returned an invalid protocol config payload.");
    }

    const config = value as Record<string, unknown>;

    return {
      minInvoiceAmount: this.toBigInt(
        this.configValue(config, "minInvoiceAmount", "min_invoice_amount", "MIN_INVOICE_AMOUNT"),
      ),
      maxDiscountRate: this.toNumberValue(
        this.configValue(config, "maxDiscountRate", "max_discount_rate", "MAX_DISCOUNT_RATE"),
        "maxDiscountRate",
      ),
      protocolFeeBps: this.toNumberValue(
        this.configValue(config, "protocolFeeBps", "protocol_fee_bps", "PROTOCOL_FEE_BPS"),
        "protocolFeeBps",
      ),
      minPayerReputation: this.toNumberValue(
        this.configValue(config, "minPayerReputation", "min_payer_reputation", "MIN_PAYER_REPUTATION"),
        "minPayerReputation",
      ),
      decayRateBps: this.toNumberValue(
        this.configValue(config, "decayRateBps", "decay_rate_bps", "DECAY_RATE_BPS"),
        "decayRateBps",
      ),
      maxInvoiceDuration: this.optionalNumber(config, "maxInvoiceDuration", "max_invoice_duration", "MAX_INVOICE_DURATION"),
      minInvoiceDuration: this.optionalNumber(config, "minInvoiceDuration", "min_invoice_duration", "MIN_INVOICE_DURATION"),
      gracePeriodSeconds: this.optionalNumber(config, "gracePeriodSeconds", "grace_period_seconds", "GRACE_PERIOD_SECONDS"),
    };
  }

  private configValue(config: Record<string, unknown>, ...keys: string[]): unknown {
    for (const key of keys) {
      if (config[key] !== undefined) {
        return config[key];
      }
    }

    throw new Error(`Protocol config is missing ${keys[0]}.`);
  }

  private optionalNumber(config: Record<string, unknown>, ...keys: string[]): number | undefined {
    for (const key of keys) {
      if (config[key] !== undefined && config[key] !== null) {
        return this.toNumberValue(config[key], key);
      }
    }

    return undefined;
  }

  private extractSimulationRetval(simulation: unknown, method: string): xdr.ScVal {
    const typedSimulation = simulation as SimulationLike;

    if (typedSimulation.error) {
      const error = typedSimulation.error;
      throw new Error(
        `Simulation failed for ${method}: ${error ? String(error) : "Unknown RPC error."}`,
      );
    }

    if (!typedSimulation.result?.retval) {
      throw new Error(`Simulation for ${method} did not return a contract result.`);
    }

    return typedSimulation.result.retval;
  }

  private unwrapContractResult(value: unknown, method: string): unknown {
    if (!value || typeof value !== "object") {
      return value;
    }

    if ("ok" in value) {
      return (value as { ok: unknown }).ok;
    }
    if ("Ok" in value) {
      return (value as { Ok: unknown }).Ok;
    }
    if ("err" in value) {
      throw parseContractError((value as { err: unknown }).err);
    }
    if ("Err" in value) {
      throw parseContractError((value as { Err: unknown }).Err);
    }

    return value;
  }

  private toAddress(address: string) {
    return Address.fromString(address).toScVal();
  }

  private toBigInt(value: unknown): bigint {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number") {
      return BigInt(value);
    }
    if (typeof value === "string") {
      return BigInt(value);
    }

    throw new Error(`Expected bigint-compatible value but received ${typeof value}.`);
  }

  private toNumberValue(value: unknown, field: string): number {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "bigint") {
      return Number(value);
    }

    throw new Error(`Expected numeric ${field} value but received ${typeof value}.`);
  }

  private toStringValue(value: unknown, field: string): string {
    if (typeof value === "string") {
      return value;
    }

    throw new Error(`Expected string ${field} value but received ${typeof value}.`);
  }

  private parseStatus(value: unknown): InvoiceStatus {
    if (typeof value === "string") {
      return this.normalizeStatus(value);
    }

    if (value && typeof value === "object") {
      const [key] = Object.keys(value as Record<string, unknown>);
      if (key) {
        return this.normalizeStatus(key);
      }
    }

    throw new Error("Unable to parse invoice status from contract response.");
  }

  private normalizeStatus(value: string): InvoiceStatus {
    const normalized = value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();

    switch (normalized) {
      case "Pending":
      case "Funded":
      case "Paid":
      case "Defaulted":
        return normalized;
      default:
        throw new Error(`Unknown invoice status "${value}".`);
    }
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}


