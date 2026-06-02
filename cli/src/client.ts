import {
  Account,
  Address,
  BASE_FEE,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import { explainContractError } from "./errors";
import type {
  ClientOptions,
  Invoice,
  ListedInvoice,
  ProtocolConfig,
  RpcServerLike,
  SimulationLike,
  SubmitInvoiceInput,
  TransactionSigner,
  WriteResult,
} from "./types";

const READ_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const BASE_TIMEOUT_SECONDS = 60;
const POLL_ATTEMPTS = 30;
const PROTOCOL_CONFIG_CACHE_MS = 5 * 60 * 1000;

export class ILNClient {
  private readonly contractId: string;
  private readonly networkPassphrase: string;
  private readonly server: RpcServerLike;
  private readonly signer: TransactionSigner;
  private protocolConfigCache: { expiresAt: number; value: ProtocolConfig } | null = null;

  constructor(options: ClientOptions) {
    this.contractId = options.contractId;
    this.networkPassphrase = options.networkPassphrase;
    this.signer = options.signer;
    this.server =
      options.server ??
      new rpc.Server(options.rpcUrl, {
        allowHttp: options.rpcUrl.startsWith("http://"),
      });
  }

  async submitInvoice(input: SubmitInvoiceInput): Promise<{ invoiceId: bigint; txHash: string }> {
    const freelancer = await this.signer.getPublicKey();
    const transaction = await this.buildWriteTransaction(freelancer, "submit_invoice", [
      Address.fromString(freelancer).toScVal(),
      Address.fromString(input.payer).toScVal(),
      nativeToScVal(input.amount, { type: "i128" }),
      nativeToScVal(input.dueDate, { type: "u64" }),
      nativeToScVal(input.discountRate, { type: "u32" }),
      Address.fromString(input.tokenId).toScVal(),
    ]);

    const simulation = await this.simulate(transaction, "submit_invoice");
    const invoiceId = this.toBigInt(this.unwrapContractResult(this.extractRetval(simulation), "submit_invoice"));
    const result = await this.signAndSend(transaction, freelancer);
    return { invoiceId, txHash: result.hash };
  }

  async fundInvoice(invoiceId: bigint, amount?: bigint): Promise<WriteResult> {
    const funder = await this.signer.getPublicKey();
    const invoice = await this.getInvoice(invoiceId);
    const remaining = invoice.amount - invoice.amountFunded;
    const fundAmount = amount ?? remaining;

    if (fundAmount <= 0n) {
      throw new Error("Invoice does not have any remaining balance to fund.");
    }

    const transaction = await this.buildWriteTransaction(funder, "fund_invoice", [
      Address.fromString(funder).toScVal(),
      nativeToScVal(invoiceId, { type: "u64" }),
      nativeToScVal(fundAmount, { type: "i128" }),
    ]);

    await this.simulate(transaction, "fund_invoice");
    return this.signAndSend(transaction, funder);
  }

  async markPaid(invoiceId: bigint): Promise<WriteResult> {
    const payer = await this.signer.getPublicKey();
    const transaction = await this.buildWriteTransaction(payer, "mark_paid", [
      nativeToScVal(invoiceId, { type: "u64" }),
    ]);

    await this.simulate(transaction, "mark_paid");
    return this.signAndSend(transaction, payer);
  }

  async getInvoice(invoiceId: bigint): Promise<Invoice> {
    const transaction = this.buildReadTransaction("get_invoice", [
      nativeToScVal(invoiceId, { type: "u64" }),
    ]);
    const simulation = await this.simulate(transaction, "get_invoice");
    return this.parseInvoice(this.unwrapContractResult(this.extractRetval(simulation), "get_invoice"));
  }

  async getInvoiceCount(): Promise<bigint> {
    const transaction = this.buildReadTransaction("get_invoice_count", []);
    const simulation = await this.simulate(transaction, "get_invoice_count");
    return this.toBigInt(this.extractRetval(simulation));
  }

  async listInvoicesByAddress(address: string): Promise<ListedInvoice[]> {
    const count = await this.getInvoiceCount();
    const invoices: ListedInvoice[] = [];

    for (let index = 1n; index <= count; index += 1n) {
      const invoice = await this.getInvoice(index);
      const role = matchRole(invoice, address);
      if (role) {
        invoices.push({ ...invoice, role });
      }
    }

    return invoices;
  }

  async getProtocolConfig(): Promise<ProtocolConfig> {
    const now = Date.now();
    if (this.protocolConfigCache && this.protocolConfigCache.expiresAt > now) {
      return this.protocolConfigCache.value;
    }

    const transaction = this.buildReadTransaction("get_protocol_config", []);
    const simulation = await this.simulate(transaction, "get_protocol_config");
    const config = this.parseProtocolConfig(
      this.unwrapContractResult(this.extractRetval(simulation), "get_protocol_config"),
    );

    this.protocolConfigCache = {
      expiresAt: now + PROTOCOL_CONFIG_CACHE_MS,
      value: config,
    };

    return config;
  }

  private buildReadTransaction(method: string, args: xdr.ScVal[]) {
    return new TransactionBuilder(new Account(READ_ACCOUNT, "0"), {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          args,
          contract: this.contractId,
          function: method,
        }),
      )
      .setTimeout(BASE_TIMEOUT_SECONDS)
      .build();
  }

  private async buildWriteTransaction(sourceAddress: string, method: string, args: xdr.ScVal[]) {
    const sourceAccount = (await this.server.getAccount(sourceAddress)) as Account;

    return new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          args,
          contract: this.contractId,
          function: method,
        }),
      )
      .setTimeout(BASE_TIMEOUT_SECONDS)
      .build();
  }

  private async simulate(transaction: unknown, method: string): Promise<SimulationLike> {
    const simulation = (await this.server.simulateTransaction(transaction)) as SimulationLike;
    if (simulation.error) {
      throw new Error(`Simulation failed for ${method}: ${String(simulation.error)}`);
    }

    return simulation;
  }

  private extractRetval(simulation: SimulationLike): unknown {
    if (!simulation.result?.retval) {
      throw new Error("RPC simulation did not return a contract result.");
    }

    return scValToNative(simulation.result.retval as xdr.ScVal);
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
      throw this.contractError(method, (value as { err: unknown }).err);
    }
    if ("Err" in value) {
      throw this.contractError(method, (value as { Err: unknown }).Err);
    }

    return value;
  }

  private contractError(method: string, raw: unknown): Error {
    const code = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : null;
    const details = code == null ? JSON.stringify(raw) : explainContractError(code);
    return new Error(`Contract rejected ${method}: ${details}`);
  }

  private async signAndSend(transaction: ReturnType<TransactionBuilder["build"]>, sourceAddress: string): Promise<WriteResult> {
    let prepared: { toXDR(): string };
    try {
      prepared = await this.server.prepareTransaction(transaction);
    } catch (error) {
      throw new Error(
        `Failed to prepare transaction: ${error instanceof Error ? error.message : "unknown RPC error"}.`,
      );
    }

    const signedXdr = await this.signer.signTransaction(prepared.toXDR(), this.networkPassphrase);
    const signedTransaction = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
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

    return { hash: response.hash };
  }

  private parseInvoice(value: unknown): Invoice {
    if (!value || typeof value !== "object") {
      throw new Error("Contract returned an invalid invoice payload.");
    }

    const invoice = value as Record<string, unknown>;

    return {
      amount: this.toBigInt(invoice.amount),
      amountFunded: this.toBigInt(invoice.amount_funded ?? invoice.amountFunded ?? 0n),
      discountRate: this.toNumber(invoice.discount_rate ?? invoice.discountRate, "discount rate"),
      dueDate: this.toNumber(invoice.due_date ?? invoice.dueDate, "due date"),
      freelancer: this.toString(invoice.freelancer, "freelancer"),
      fundedAt: invoice.funded_at == null && invoice.fundedAt == null
        ? null
        : this.toNumber(invoice.funded_at ?? invoice.fundedAt, "funded at"),
      funder: invoice.funder == null ? null : this.toString(invoice.funder, "funder"),
      id: this.toBigInt(invoice.id),
      payer: this.toString(invoice.payer, "payer"),
      status: this.parseStatus(invoice.status),
      token: this.toString(invoice.token, "token"),
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
      maxDiscountRate: this.toNumber(
        this.configValue(config, "maxDiscountRate", "max_discount_rate", "MAX_DISCOUNT_RATE"),
        "max discount rate",
      ),
      protocolFeeBps: this.toNumber(
        this.configValue(config, "protocolFeeBps", "protocol_fee_bps", "PROTOCOL_FEE_BPS"),
        "protocol fee bps",
      ),
      minPayerReputation: this.toNumber(
        this.configValue(config, "minPayerReputation", "min_payer_reputation", "MIN_PAYER_REPUTATION"),
        "min payer reputation",
      ),
      decayRateBps: this.toNumber(
        this.configValue(config, "decayRateBps", "decay_rate_bps", "DECAY_RATE_BPS"),
        "decay rate bps",
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
        return this.toNumber(config[key], key);
      }
    }

    return undefined;
  }

  private parseStatus(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      if (keys.length === 1) {
        return keys[0];
      }
    }

    throw new Error("Contract returned an invalid invoice status.");
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

    throw new Error(`Expected bigint-like value, received ${typeof value}.`);
  }

  private toNumber(value: unknown, field: string): number {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "bigint") {
      return Number(value);
    }

    throw new Error(`Expected numeric ${field}, received ${typeof value}.`);
  }

  private toString(value: unknown, field: string): string {
    if (typeof value === "string") {
      return value;
    }

    throw new Error(`Expected string ${field}, received ${typeof value}.`);
  }
}

function matchRole(invoice: Invoice, address: string): ListedInvoice["role"] | null {
  if (invoice.freelancer === address) {
    return "freelancer";
  }
  if (invoice.payer === address) {
    return "payer";
  }
  if (invoice.funder === address) {
    return "funder";
  }

  return null;
}
