import type {
  Invoice,
  InvoiceClient,
  InvoiceStatus,
  PayerScore,
  SubmitInvoiceArgs,
  SubmittedInvoiceResult,
  TokenMetadata,
  UpdateInvoiceArgs,
} from "./types.js";

import {
  SEED_INVOICES,
  SEED_REPUTATION,
  SEED_BALANCES,
  SEED_ALLOWANCES,
  TOKEN_METADATA_MAP,
  USDC_ID,
} from "./seed.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fakeTxHash(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
}

function delay(ms = 80): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── MockInvoiceClient ────────────────────────────────────────────────────────

/**
 * In-memory implementation of {@link InvoiceClient}.
 * All state lives in JavaScript Maps — no Stellar node required.
 *
 * Mutating operations (submit, fund, markPaid, claimDefault, cancel, update)
 * update in-memory state and return a synthetic tx hash so the frontend can
 * treat the mock the same way it treats real contract responses.
 */
export class MockInvoiceClient implements InvoiceClient {
  /** Invoice store keyed by id */
  private readonly invoices: Map<bigint, Invoice>;

  /** Reputation scores keyed by payer address */
  private readonly reputation: Map<string, PayerScore>;

  /** Token balances keyed by `${tokenId}:${address}` */
  private readonly balances: Map<string, bigint>;

  /** Token allowances keyed by `${tokenId}:${owner}:${spender}` */
  private readonly allowances: Map<string, bigint>;

  /** Default spender contract ID used for allowance lookups */
  private readonly contractId: string;

  constructor(options?: {
    /** Replace seed invoices with a custom set. */
    invoices?: Invoice[];
    /** Replace seed reputation with a custom map. */
    reputation?: Map<string, PayerScore>;
    /** Replace seed balances with a custom map. */
    balances?: Map<string, bigint>;
    /** Replace seed allowances with a custom map. */
    allowances?: Map<string, bigint>;
    /** Simulated contract address used as the default spender. */
    contractId?: string;
    /** Simulated network latency in ms (default 80). */
    latencyMs?: number;
  }) {
    const seedInvoices = options?.invoices ?? SEED_INVOICES;
    this.invoices = new Map(seedInvoices.map((inv) => [inv.id, { ...inv }]));
    this.reputation = options?.reputation ?? new Map(SEED_REPUTATION);
    this.balances = options?.balances ?? new Map(SEED_BALANCES);
    this.allowances = options?.allowances ?? new Map(SEED_ALLOWANCES);
    this.contractId = options?.contractId ?? "MOCK_CONTRACT";
  }

  // ─── Read: invoices ─────────────────────────────────────────────────────────

  async getInvoiceCount(): Promise<bigint> {
    await delay();
    return BigInt(this.invoices.size);
  }

  async getInvoice(id: bigint): Promise<Invoice> {
    await delay();
    const invoice = this.invoices.get(id);
    if (!invoice) {
      throw new Error(`Invoice ${id} not found`);
    }
    return { ...invoice };
  }

  async getAllInvoices(): Promise<Invoice[]> {
    await delay();
    return [...this.invoices.values()].map((inv) => ({ ...inv }));
  }

  // ─── Read: tokens ───────────────────────────────────────────────────────────

  async getApprovedTokenIds(): Promise<string[]> {
    await delay();
    return Object.keys(TOKEN_METADATA_MAP);
  }

  async getTokenMetadata(tokenId: string): Promise<TokenMetadata> {
    await delay();
    const meta = TOKEN_METADATA_MAP[tokenId];
    if (meta) {
      return { contractId: tokenId, ...meta };
    }
    // Unknown token — return a generic placeholder
    return {
      contractId: tokenId,
      name: "Unknown Token",
      symbol: tokenId.slice(0, 4).toUpperCase(),
      decimals: 7,
    };
  }

  async getTokenBalance(address: string, tokenId: string = USDC_ID): Promise<bigint> {
    await delay();
    return this.balances.get(`${tokenId}:${address}`) ?? 0n;
  }

  async getTokenAllowance({
    owner,
    spender,
    tokenId = USDC_ID,
  }: {
    owner: string;
    spender?: string;
    tokenId?: string;
  }): Promise<bigint> {
    await delay();
    const resolvedSpender = spender ?? this.contractId;
    return this.allowances.get(`${tokenId}:${owner}:${resolvedSpender}`) ?? 0n;
  }

  // ─── Read: reputation ───────────────────────────────────────────────────────

  async getPayerScore(payerAddress: string): Promise<PayerScore | null> {
    await delay();
    return this.reputation.get(payerAddress) ?? null;
  }

  async getPayerScoresBatch(
    addresses: string[]
  ): Promise<Map<string, PayerScore | null>> {
    await delay();
    const result = new Map<string, PayerScore | null>();
    for (const addr of addresses) {
      result.set(addr, this.reputation.get(addr) ?? null);
    }
    return result;
  }

  // ─── Write: invoices ────────────────────────────────────────────────────────

  async submitInvoice(args: SubmitInvoiceArgs): Promise<SubmittedInvoiceResult> {
    await delay(150);

    const nextId = BigInt(this.invoices.size + 1);
    const invoice: Invoice = {
      id: nextId,
      freelancer: args.freelancer,
      payer: args.payer,
      amount: args.amount,
      due_date: BigInt(args.dueDate),
      discount_rate: args.discountRate,
      status: "Pending",
      funder: null,
      funded_at: null,
      token: args.token ?? USDC_ID,
    };

    this.invoices.set(nextId, invoice);
    return { invoiceId: nextId, txHash: fakeTxHash() };
  }

  async fundInvoice(funder: string, invoiceId: bigint): Promise<{ txHash: string }> {
    await delay(150);

    const invoice = this.requireInvoice(invoiceId);
    this.assertStatus(invoice, "Pending", "fund");

    invoice.status = "Funded";
    invoice.funder = funder;
    invoice.funded_at = BigInt(Math.floor(Date.now() / 1000));
    this.invoices.set(invoiceId, invoice);

    return { txHash: fakeTxHash() };
  }

  async markPaid(payer: string, invoiceId: bigint): Promise<{ txHash: string }> {
    await delay(150);

    const invoice = this.requireInvoice(invoiceId);
    if (invoice.payer !== payer) {
      throw new Error(`Address ${payer} is not the payer for invoice ${invoiceId}`);
    }
    this.assertStatus(invoice, "Funded", "mark as paid");

    invoice.status = "Paid";
    this.invoices.set(invoiceId, invoice);

    // Update reputation for the payer
    const existing = this.reputation.get(payer) ?? { score: 50, settled_on_time: 0, defaults: 0 };
    const settled = existing.settled_on_time + 1;
    this.reputation.set(payer, {
      score: Math.min(100, Math.round((settled / (settled + existing.defaults)) * 100)),
      settled_on_time: settled,
      defaults: existing.defaults,
    });

    return { txHash: fakeTxHash() };
  }

  async claimDefault(funder: string, invoiceId: bigint): Promise<{ txHash: string }> {
    await delay(150);

    const invoice = this.requireInvoice(invoiceId);
    if (invoice.funder !== funder) {
      throw new Error(`Address ${funder} is not the funder for invoice ${invoiceId}`);
    }
    this.assertStatus(invoice, "Funded", "claim default");

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (invoice.due_date > nowSec) {
      throw new Error(`Invoice ${invoiceId} is not past its due date yet`);
    }

    invoice.status = "Defaulted";
    this.invoices.set(invoiceId, invoice);

    // Update reputation for the payer
    const payer = invoice.payer;
    const existing = this.reputation.get(payer) ?? { score: 50, settled_on_time: 0, defaults: 0 };
    const defaults = existing.defaults + 1;
    const total = existing.settled_on_time + defaults;
    this.reputation.set(payer, {
      score: total > 0 ? Math.max(0, Math.round((existing.settled_on_time / total) * 100)) : 0,
      settled_on_time: existing.settled_on_time,
      defaults,
    });

    return { txHash: fakeTxHash() };
  }

  async cancelInvoice(freelancer: string, invoiceId: bigint): Promise<{ txHash: string }> {
    await delay(150);

    const invoice = this.requireInvoice(invoiceId);
    if (invoice.freelancer !== freelancer) {
      throw new Error(`Address ${freelancer} is not the freelancer for invoice ${invoiceId}`);
    }
    this.assertStatus(invoice, "Pending", "cancel");

    invoice.status = "Cancelled";
    this.invoices.set(invoiceId, invoice);
    return { txHash: fakeTxHash() };
  }

  async updateInvoice(args: UpdateInvoiceArgs): Promise<{ txHash: string }> {
    await delay(150);

    const invoice = this.requireInvoice(args.invoiceId);
    if (invoice.freelancer !== args.freelancer) {
      throw new Error(`Address ${args.freelancer} is not the freelancer for invoice ${args.invoiceId}`);
    }
    this.assertStatus(invoice, "Pending", "update");

    invoice.amount = args.amount;
    invoice.due_date = BigInt(args.dueDate);
    invoice.discount_rate = args.discountRate;
    this.invoices.set(args.invoiceId, invoice);
    return { txHash: fakeTxHash() };
  }

  async approveToken(args: {
    owner: string;
    amount: bigint;
    spender?: string;
    tokenId?: string;
  }): Promise<{ txHash: string }> {
    await delay(100);

    const tokenId = args.tokenId ?? USDC_ID;
    const spender = args.spender ?? this.contractId;
    this.allowances.set(`${tokenId}:${args.owner}:${spender}`, args.amount);
    return { txHash: fakeTxHash() };
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  private requireInvoice(id: bigint): Invoice {
    const invoice = this.invoices.get(id);
    if (!invoice) {
      throw new Error(`Invoice ${id} not found`);
    }
    return { ...invoice };
  }

  private assertStatus(invoice: Invoice, expected: InvoiceStatus, action: string): void {
    if (invoice.status !== expected) {
      throw new Error(
        `Cannot ${action} invoice ${invoice.id}: expected status "${expected}", got "${invoice.status}"`
      );
    }
  }
}
