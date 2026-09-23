/**
 * Payment processing module for the ILN SDK (#593).
 *
 * Provides partial payment support, multi-token payments, payment
 * scheduling, payment verification, and payment history tracking.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type PaymentStatus =
  | 'pending'
  | 'scheduled'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TokenAmount {
  tokenId: string;
  amount: bigint;
  symbol?: string;
}

export interface PartialPaymentParams {
  invoiceId: bigint;
  /** Amount to pay in this installment (in smallest token units). */
  amount: bigint;
  tokenId: string;
  /** Optional memo to attach to the payment transaction. */
  memo?: string;
}

export interface MultiTokenPaymentParams {
  invoiceId: bigint;
  /** Token amounts to combine for this payment. */
  tokens: TokenAmount[];
  /** Optional memo to attach to the payment transaction. */
  memo?: string;
}

export interface ScheduledPayment {
  id: string;
  invoiceId: bigint;
  tokenId: string;
  amount: bigint;
  scheduledAt: string;
  executeAt: number;
  status: PaymentStatus;
  memo?: string;
  createdAt: string;
  updatedAt: string;
  executedAt?: string;
  failureReason?: string;
  txHash?: string;
}

export interface SchedulePaymentParams {
  invoiceId: bigint;
  tokenId: string;
  amount: bigint;
  executeAt: number | Date;
  memo?: string;
}

export interface PaymentRecord {
  id: string;
  invoiceId: bigint;
  type: 'partial' | 'full' | 'multi-token' | 'scheduled';
  status: PaymentStatus;
  tokens: TokenAmount[];
  totalAmount: bigint;
  txHash?: string;
  createdAt: string;
  completedAt?: string;
  failureReason?: string;
  memo?: string;
}

export interface PaymentVerificationResult {
  verified: boolean;
  invoiceId: bigint;
  expectedAmount: bigint;
  paidAmount: bigint;
  remainingAmount: bigint;
  isFullyPaid: boolean;
  payments: PaymentRecord[];
  verifiedAt: string;
  issues: string[];
}

export interface PaymentHistoryOptions {
  invoiceId?: bigint;
  address?: string;
  status?: PaymentStatus;
  type?: PaymentRecord['type'];
  fromDate?: number;
  toDate?: number;
  limit?: number;
}

// ── ID generator ───────────────────────────────────────────────────────────

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `pay_${timestamp}_${random}`;
}

// ── Client interface ───────────────────────────────────────────────────────

export interface PaymentClient {
  /** Fund an invoice with a specific amount and token. */
  fundInvoice(invoiceId: bigint, amount?: bigint): Promise<{ hash: string }>;
  /** Get an invoice by its ID. */
  getInvoice(invoiceId: bigint): Promise<{
    id: bigint;
    amount: bigint;
    fundedAmount?: bigint;
    status: string;
    tokenId: string;
  }>;
}

// ── Payment processor ─────────────────────────────────────────────────────

export class PaymentProcessor {
  private readonly client: PaymentClient;
  private readonly history: Map<string, PaymentRecord> = new Map();
  private readonly scheduledPayments: Map<string, ScheduledPayment> = new Map();
  private schedulerTimer?: ReturnType<typeof setInterval>;

  constructor(client: PaymentClient) {
    this.client = client;
  }

  // ── Partial payments ─────────────────────────────────────────────────────

  /**
   * Submit a partial payment toward an invoice.
   * The amount must be less than or equal to the remaining unfunded balance.
   */
  async payPartial(params: PartialPaymentParams): Promise<PaymentRecord> {
    const { invoiceId, amount, tokenId, memo } = params;

    const invoice = await this.client.getInvoice(invoiceId);
    const funded = invoice.fundedAmount ?? 0n;
    const remaining = invoice.amount - funded;

    if (amount <= 0n) {
      throw new RangeError('Partial payment amount must be greater than zero');
    }
    if (amount > remaining) {
      throw new RangeError(
        `Partial payment amount ${amount} exceeds remaining balance ${remaining}`
      );
    }

    const record: PaymentRecord = {
      id: generateId(),
      invoiceId,
      type: 'partial',
      status: 'processing',
      tokens: [{ tokenId, amount }],
      totalAmount: amount,
      createdAt: new Date().toISOString(),
      memo,
    };

    this.history.set(record.id, record);

    try {
      const result = await this.client.fundInvoice(invoiceId, amount);
      record.status = 'completed';
      record.txHash = result.hash;
      record.completedAt = new Date().toISOString();
    } catch (err) {
      record.status = 'failed';
      record.failureReason = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.history.set(record.id, { ...record });
    }

    return record;
  }

  // ── Multi-token payments ─────────────────────────────────────────────────

  /**
   * Submit payments across multiple tokens for a single invoice.
   * Each token is submitted as a separate transaction. All succeed or the
   * error is surfaced after partial completion.
   */
  async payMultiToken(params: MultiTokenPaymentParams): Promise<PaymentRecord[]> {
    const { invoiceId, tokens, memo } = params;

    if (tokens.length === 0) {
      throw new Error('At least one token amount is required for a multi-token payment');
    }

    const records: PaymentRecord[] = [];

    for (const { tokenId, amount, symbol } of tokens) {
      if (amount <= 0n) {
        throw new RangeError(`Token ${tokenId}: amount must be greater than zero`);
      }

      const record: PaymentRecord = {
        id: generateId(),
        invoiceId,
        type: 'multi-token',
        status: 'processing',
        tokens: [{ tokenId, amount, symbol }],
        totalAmount: amount,
        createdAt: new Date().toISOString(),
        memo,
      };

      this.history.set(record.id, record);

      try {
        const result = await this.client.fundInvoice(invoiceId, amount);
        record.status = 'completed';
        record.txHash = result.hash;
        record.completedAt = new Date().toISOString();
      } catch (err) {
        record.status = 'failed';
        record.failureReason = err instanceof Error ? err.message : String(err);
        this.history.set(record.id, { ...record });
        throw err;
      }

      this.history.set(record.id, { ...record });
      records.push(record);
    }

    return records;
  }

  // ── Payment scheduling ────────────────────────────────────────────────────

  /**
   * Schedule a payment to be executed at a future time.
   * The scheduler polls every 30 seconds; call `startScheduler()` to activate it.
   */
  schedulePayment(params: SchedulePaymentParams): ScheduledPayment {
    const { invoiceId, tokenId, amount, executeAt, memo } = params;
    const executeAtTs =
      executeAt instanceof Date ? Math.floor(executeAt.getTime() / 1000) : executeAt;

    if (executeAtTs <= Math.floor(Date.now() / 1000)) {
      throw new RangeError('executeAt must be in the future');
    }
    if (amount <= 0n) {
      throw new RangeError('Scheduled payment amount must be greater than zero');
    }

    const scheduled: ScheduledPayment = {
      id: generateId(),
      invoiceId,
      tokenId,
      amount,
      scheduledAt: new Date().toISOString(),
      executeAt: executeAtTs,
      status: 'scheduled',
      memo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.scheduledPayments.set(scheduled.id, scheduled);
    return scheduled;
  }

  /**
   * Cancel a previously scheduled payment.
   */
  cancelScheduledPayment(id: string): ScheduledPayment {
    const payment = this.scheduledPayments.get(id);
    if (!payment) {
      throw new Error(`Scheduled payment ${id} not found`);
    }
    if (payment.status !== 'scheduled') {
      throw new Error(`Cannot cancel payment in status '${payment.status}'`);
    }

    payment.status = 'cancelled';
    payment.updatedAt = new Date().toISOString();
    this.scheduledPayments.set(id, payment);
    return payment;
  }

  /**
   * Start the background scheduler that executes due payments.
   * Call `stopScheduler()` to clean up.
   *
   * @param intervalMs - Polling interval in milliseconds (default: 30 000).
   */
  startScheduler(intervalMs = 30_000): void {
    if (this.schedulerTimer) return;

    this.schedulerTimer = setInterval(() => {
      this.runSchedulerTick().catch(() => {
        // Errors are recorded on individual payment records
      });
    }, intervalMs);
  }

  /**
   * Stop the background scheduler.
   */
  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = undefined;
    }
  }

  private async runSchedulerTick(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    for (const [id, payment] of this.scheduledPayments) {
      if (payment.status !== 'scheduled' || payment.executeAt > now) continue;

      payment.status = 'processing';
      payment.updatedAt = new Date().toISOString();
      this.scheduledPayments.set(id, payment);

      try {
        const result = await this.client.fundInvoice(payment.invoiceId, payment.amount);
        payment.status = 'completed';
        payment.txHash = result.hash;
        payment.executedAt = new Date().toISOString();
      } catch (err) {
        payment.status = 'failed';
        payment.failureReason = err instanceof Error ? err.message : String(err);
      }

      payment.updatedAt = new Date().toISOString();
      this.scheduledPayments.set(id, { ...payment });
    }
  }

  /**
   * Return all scheduled payments, optionally filtered by status.
   */
  getScheduledPayments(status?: PaymentStatus): ScheduledPayment[] {
    const all = Array.from(this.scheduledPayments.values());
    return status ? all.filter((p) => p.status === status) : all;
  }

  // ── Payment verification ──────────────────────────────────────────────────

  /**
   * Verify the payment state of an invoice against the payment history.
   * Checks whether the on-chain invoice amount matches recorded payments.
   */
  async verifyPayment(invoiceId: bigint): Promise<PaymentVerificationResult> {
    const invoice = await this.client.getInvoice(invoiceId);
    const invoicePayments = Array.from(this.history.values()).filter(
      (r) => r.invoiceId === invoiceId && r.status === 'completed'
    );

    const paidAmount = invoicePayments.reduce((sum, r) => sum + r.totalAmount, 0n);

    const expectedAmount = invoice.amount;
    const fundedOnChain = invoice.fundedAmount ?? 0n;
    const remainingAmount = expectedAmount - fundedOnChain;
    const isFullyPaid = fundedOnChain >= expectedAmount;

    const issues: string[] = [];

    if (paidAmount !== fundedOnChain) {
      issues.push(
        `Local payment history (${paidAmount}) does not match on-chain funded amount (${fundedOnChain}). ` +
          'Payments made outside this SDK instance are not tracked locally.'
      );
    }

    return {
      verified: issues.length === 0,
      invoiceId,
      expectedAmount,
      paidAmount: fundedOnChain,
      remainingAmount,
      isFullyPaid,
      payments: invoicePayments,
      verifiedAt: new Date().toISOString(),
      issues,
    };
  }

  // ── Payment history ───────────────────────────────────────────────────────

  /**
   * Return payment records filtered by the given options.
   */
  getPaymentHistory(options: PaymentHistoryOptions = {}): PaymentRecord[] {
    let records = Array.from(this.history.values());

    if (options.invoiceId !== undefined) {
      records = records.filter((r) => r.invoiceId === options.invoiceId);
    }
    if (options.status) {
      records = records.filter((r) => r.status === options.status);
    }
    if (options.type) {
      records = records.filter((r) => r.type === options.type);
    }
    if (options.fromDate !== undefined) {
      const from = options.fromDate;
      records = records.filter((r) => new Date(r.createdAt).getTime() / 1000 >= from);
    }
    if (options.toDate !== undefined) {
      const to = options.toDate;
      records = records.filter((r) => new Date(r.createdAt).getTime() / 1000 <= to);
    }

    records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (options.limit !== undefined) {
      records = records.slice(0, options.limit);
    }

    return records;
  }

  /**
   * Return a summary of payment history grouped by status.
   */
  getPaymentSummary(): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    totalVolume: bigint;
  } {
    const records = Array.from(this.history.values());
    return {
      total: records.length,
      completed: records.filter((r) => r.status === 'completed').length,
      failed: records.filter((r) => r.status === 'failed').length,
      pending: records.filter((r) => r.status === 'pending' || r.status === 'processing').length,
      totalVolume: records
        .filter((r) => r.status === 'completed')
        .reduce((sum, r) => sum + r.totalAmount, 0n),
    };
  }

  /**
   * Clear the in-memory payment history (does not affect on-chain state).
   */
  clearHistory(): void {
    this.history.clear();
  }
}

// ── Convenience factory ────────────────────────────────────────────────────

/**
 * Create a PaymentProcessor instance wrapping any ILN-compatible client.
 *
 * @example
 * ```ts
 * const processor = createPaymentProcessor(client);
 *
 * // Partial payment
 * await processor.payPartial({ invoiceId: 1n, amount: 50_000_000n, tokenId: "CUSDC..." });
 *
 * // Multi-token payment
 * await processor.payMultiToken({
 *   invoiceId: 1n,
 *   tokens: [
 *     { tokenId: "CUSDC...", amount: 30_000_000n },
 *     { tokenId: "CEURC...", amount: 20_000_000n },
 *   ],
 * });
 *
 * // Schedule a future payment
 * const scheduled = processor.schedulePayment({
 *   invoiceId: 2n,
 *   tokenId: "CUSDC...",
 *   amount: 100_000_000n,
 *   executeAt: new Date("2026-12-31T00:00:00Z"),
 * });
 *
 * // Verify payment state
 * const verification = await processor.verifyPayment(1n);
 * console.log(verification.isFullyPaid);
 *
 * // Payment history
 * const history = processor.getPaymentHistory({ invoiceId: 1n });
 * ```
 */
export function createPaymentProcessor(client: PaymentClient): PaymentProcessor {
  return new PaymentProcessor(client);
}
