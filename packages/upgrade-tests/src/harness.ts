import type {
  ContractSemanticVersion,
  InvoiceStorageV1,
  InvoiceStorageV2,
  UpgradeSimulationState,
  UpgradeOptions,
  UpgradeResult,
  CompatibilityReport,
  UpgradeEvent,
} from './types';

export class UnauthorizedUpgradeError extends Error {
  constructor(caller: string, admin: string) {
    super(`Caller ${caller} is not authorized to upgrade contract (admin is ${admin})`);
    this.name = 'UnauthorizedUpgradeError';
  }
}

export class InvalidVersionUpgradeError extends Error {
  constructor(fromVersion: string, toVersion: string) {
    super(`Cannot upgrade contract from version ${fromVersion} to ${toVersion}`);
    this.name = 'InvalidVersionUpgradeError';
  }
}

export class ContractPausedError extends Error {
  constructor() {
    super('Contract is currently paused by emergency circuit breaker');
    this.name = 'ContractPausedError';
  }
}

export class UpgradeTestHarness {
  private state: UpgradeSimulationState;

  constructor(initialState?: Partial<UpgradeSimulationState>) {
    this.state = {
      contractId: initialState?.contractId ?? 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      currentVersion: initialState?.currentVersion ?? '0.1.0',
      currentWasmHash: initialState?.currentWasmHash ?? 'wasm_hash_v1_0000000000000000000000000000000000000000000000000000000000',
      admin: initialState?.admin ?? 'GADMIN777777777777777777777777777777777777777777777777777777',
      isPaused: initialState?.isPaused ?? false,
      instanceStorage: initialState?.instanceStorage ?? new Map<string, unknown>(),
      persistentStorage: initialState?.persistentStorage ?? new Map<string, unknown>(),
      temporaryStorage: initialState?.temporaryStorage ?? new Map<string, unknown>(),
      emittedEvents: initialState?.emittedEvents ?? [],
    };
  }

  getState(): UpgradeSimulationState {
    return {
      ...this.state,
      instanceStorage: new Map(this.state.instanceStorage),
      persistentStorage: new Map(this.state.persistentStorage),
      temporaryStorage: new Map(this.state.temporaryStorage),
      emittedEvents: [...this.state.emittedEvents],
    };
  }

  setAdmin(newAdmin: string): void {
    this.state.admin = newAdmin;
  }

  setPaused(paused: boolean): void {
    this.state.isPaused = paused;
    this.emitEvent('EmergencyPauseToggled', { isPaused: paused });
  }

  isPaused(): boolean {
    return this.state.isPaused;
  }

  getVersion(): ContractSemanticVersion {
    return this.state.currentVersion;
  }

  getWasmHash(): string {
    return this.state.currentWasmHash;
  }

  // ── V1 Operations ──────────────────────────────────────────────────────────

  submitInvoiceV1(input: Omit<InvoiceStorageV1, 'status' | 'amountFunded' | 'amountPaid' | 'funder' | 'createdAt' | 'fundedAt' | 'paidAt'>): bigint {
    if (this.state.isPaused) throw new ContractPausedError();

    const invoice: InvoiceStorageV1 = {
      ...input,
      status: 'Pending',
      funder: null,
      amountFunded: 0n,
      amountPaid: 0n,
      createdAt: Math.floor(Date.now() / 1000),
      fundedAt: null,
      paidAt: null,
    };

    const key = `invoice:${String(invoice.id)}`;
    this.state.persistentStorage.set(key, invoice);
    this.emitEvent('InvoiceSubmitted', { invoiceId: invoice.id, amount: invoice.amount });
    return invoice.id;
  }

  fundInvoiceV1(invoiceId: bigint, funder: string): void {
    if (this.state.isPaused) throw new ContractPausedError();

    const key = `invoice:${String(invoiceId)}`;
    const invoice = this.state.persistentStorage.get(key) as InvoiceStorageV1 | undefined;
    if (!invoice) throw new Error(`Invoice #${String(invoiceId)} not found`);
    if (invoice.status !== 'Pending') throw new Error(`Invoice #${String(invoiceId)} cannot be funded`);

    invoice.status = 'Funded';
    invoice.funder = funder;
    invoice.amountFunded = invoice.amount;
    invoice.fundedAt = Math.floor(Date.now() / 1000);

    this.state.persistentStorage.set(key, invoice);
    this.emitEvent('InvoiceFunded', { invoiceId, funder, amount: invoice.amount });
  }

  getInvoiceV1(invoiceId: bigint): InvoiceStorageV1 | null {
    const key = `invoice:${String(invoiceId)}`;
    const invoice = this.state.persistentStorage.get(key) as InvoiceStorageV1 | undefined;
    return invoice ? { ...invoice } : null;
  }

  // ── Upgrade Engine ─────────────────────────────────────────────────────────

  async upgradeContract(options: UpgradeOptions): Promise<UpgradeResult> {
    const start = Date.now();
    const oldVersion = this.state.currentVersion;
    const oldWasmHash = this.state.currentWasmHash;

    // 1. Authorization check
    if (options.caller !== this.state.admin) {
      throw new UnauthorizedUpgradeError(options.caller, this.state.admin);
    }

    // 2. Version validation
    if (options.newVersion === oldVersion) {
      throw new InvalidVersionUpgradeError(oldVersion, options.newVersion);
    }

    let initialKeysCount = this.state.persistentStorage.size + this.state.instanceStorage.size;

    // 3. Dry-run support
    if (options.dryRun) {
      return {
        success: true,
        oldVersion,
        newVersion: options.newVersion,
        oldWasmHash,
        newWasmHash: options.newWasmHash,
        migratedKeysCount: 0,
        durationMs: Date.now() - start,
        events: [],
      };
    }

    // 4. State updates
    this.state.currentVersion = options.newVersion;
    this.state.currentWasmHash = options.newWasmHash;

    // 5. Execute migration hook if provided
    if (options.migrationHook) {
      await options.migrationHook(this.state);
    }

    // 6. Record upgrade event
    const upgradeEvent: UpgradeEvent = {
      topic: 'ContractUpgraded',
      data: {
        oldVersion,
        newVersion: options.newVersion,
        oldWasmHash,
        newWasmHash: options.newWasmHash,
        admin: options.caller,
      },
      ledger: 1000n,
      timestamp: Math.floor(Date.now() / 1000),
    };
    this.state.emittedEvents.push(upgradeEvent);

    return {
      success: true,
      oldVersion,
      newVersion: options.newVersion,
      oldWasmHash,
      newWasmHash: options.newWasmHash,
      migratedKeysCount: this.state.persistentStorage.size,
      durationMs: Date.now() - start,
      events: [upgradeEvent],
    };
  }

  // ── V2 Operations (Schema Evolution & Backward Compatibility) ──────────────

  getInvoiceV2(invoiceId: bigint): InvoiceStorageV2 | null {
    const key = `invoice:${String(invoiceId)}`;
    const stored = this.state.persistentStorage.get(key) as (InvoiceStorageV1 & Partial<InvoiceStorageV2>) | undefined;
    if (!stored) return null;

    // Backward compatibility adapter: seamlessly adapts legacy V1 storage records to V2 schema
    return {
      ...stored,
      isAuction: stored.isAuction ?? false,
      auctionStartRate: stored.auctionStartRate ?? null,
      auctionMinRate: stored.auctionMinRate ?? null,
      auctionDecayMinutes: stored.auctionDecayMinutes ?? null,
      allowedLps: stored.allowedLps ?? null,
      referralCode: stored.referralCode ?? null,
      disputeId: stored.disputeId ?? null,
      version: 2,
    };
  }

  submitInvoiceV2(
    input: Omit<InvoiceStorageV1, 'status' | 'amountFunded' | 'amountPaid' | 'funder' | 'createdAt' | 'fundedAt' | 'paidAt'> & {
      isAuction?: boolean;
      auctionStartRate?: number;
      auctionMinRate?: number;
      auctionDecayMinutes?: number;
      allowedLps?: string[];
      referralCode?: string;
    }
  ): bigint {
    if (this.state.isPaused) throw new ContractPausedError();

    const invoice: InvoiceStorageV2 = {
      ...input,
      status: 'Pending',
      funder: null,
      amountFunded: 0n,
      amountPaid: 0n,
      createdAt: Math.floor(Date.now() / 1000),
      fundedAt: null,
      paidAt: null,
      isAuction: input.isAuction ?? false,
      auctionStartRate: input.auctionStartRate ?? null,
      auctionMinRate: input.auctionMinRate ?? null,
      auctionDecayMinutes: input.auctionDecayMinutes ?? null,
      allowedLps: input.allowedLps ?? null,
      referralCode: input.referralCode ?? null,
      disputeId: null,
      version: 2,
    };

    const key = `invoice:${String(invoice.id)}`;
    this.state.persistentStorage.set(key, invoice);
    this.emitEvent('InvoiceSubmittedV2', {
      invoiceId: invoice.id,
      amount: invoice.amount,
      isAuction: invoice.isAuction,
      referralCode: invoice.referralCode,
    });
    return invoice.id;
  }

  setInstanceStorage(key: string, value: unknown): void {
    this.state.instanceStorage.set(key, value);
  }

  getInstanceStorage(key: string): unknown {
    return this.state.instanceStorage.get(key);
  }

  // ── Invariant Verification ─────────────────────────────────────────────────

  verifyStorageInvariants(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    let totalFunded = 0n;

    for (const [key, value] of this.state.persistentStorage.entries()) {
      if (key.startsWith('invoice:')) {
        const inv = value as InvoiceStorageV1;
        if (!inv.id || inv.amount <= 0n) {
          errors.push(`Invalid invoice record at ${key}`);
        }
        if (inv.status === 'Funded' && (!inv.funder || inv.amountFunded <= 0n)) {
          errors.push(`Funded invoice ${key} missing funder or funded amount`);
        }
        totalFunded += inv.amountFunded;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ── Compatibility Evaluator ────────────────────────────────────────────────

  evaluateCompatibility(sdkVersion: string, contractVersion: string): CompatibilityReport {
    const [sdkMajor] = sdkVersion.split('.').map(Number);
    const [contractMajor] = contractVersion.split('.').map(Number);

    const isCompatible = sdkMajor === contractMajor || Math.abs(sdkMajor - contractMajor) <= 1;

    return {
      isCompatible,
      supportedMethods: [
        'submit_invoice',
        'fund_invoice',
        'mark_paid',
        'get_invoice',
        ...(contractMajor >= 2 ? ['dispute_invoice', 'resolve_dispute', 'submit_auction_invoice'] : []),
      ],
      deprecatedMethods: contractMajor >= 2 ? ['get_version'] : [],
      missingMethods: [],
      storageInvariantsPreserved: true,
      schemaDiff: {
        addedFields: contractMajor >= 2 ? ['is_auction', 'allowed_lps', 'referral_code', 'dispute_id'] : [],
        removedFields: [],
        modifiedFields: [],
      },
    };
  }

  private emitEvent(topic: string, data: Record<string, unknown>): void {
    this.state.emittedEvents.push({
      topic,
      data,
      ledger: 100n,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }
}
