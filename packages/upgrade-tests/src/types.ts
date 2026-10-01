import type { InvoiceStatus } from '@iln/shared';

export type ContractSemanticVersion = `${number}.${number}.${number}`;

export interface InvoiceStorageV1 {
  id: bigint;
  freelancer: string;
  payer: string;
  amount: bigint;
  token: string;
  dueDate: number;
  discountRate: number;
  status: InvoiceStatus;
  funder: string | null;
  amountFunded: bigint;
  amountPaid: bigint;
  createdAt: number;
  fundedAt: number | null;
  paidAt: number | null;
}

export interface InvoiceStorageV2 extends InvoiceStorageV1 {
  // Added in v2.0.0
  isAuction: boolean;
  auctionStartRate: number | null;
  auctionMinRate: number | null;
  auctionDecayMinutes: number | null;
  allowedLps: string[] | null;
  referralCode: string | null;
  disputeId: bigint | null;
  version: 2;
}

export interface UpgradeSimulationState {
  contractId: string;
  currentVersion: ContractSemanticVersion;
  currentWasmHash: string;
  admin: string;
  isPaused: boolean;
  instanceStorage: Map<string, unknown>;
  persistentStorage: Map<string, unknown>;
  temporaryStorage: Map<string, unknown>;
  emittedEvents: UpgradeEvent[];
}

export interface UpgradeEvent {
  topic: string;
  data: Record<string, unknown>;
  ledger: bigint;
  timestamp: number;
}

export interface UpgradeOptions {
  caller: string;
  newWasmHash: string;
  newVersion: ContractSemanticVersion;
  migrationHook?: (state: UpgradeSimulationState) => void | Promise<void>;
  dryRun?: boolean;
}

export interface UpgradeResult {
  success: boolean;
  oldVersion: ContractSemanticVersion;
  newVersion: ContractSemanticVersion;
  oldWasmHash: string;
  newWasmHash: string;
  migratedKeysCount: number;
  durationMs: number;
  events: UpgradeEvent[];
  error?: string;
}

export interface CompatibilityReport {
  isCompatible: boolean;
  supportedMethods: string[];
  deprecatedMethods: string[];
  missingMethods: string[];
  storageInvariantsPreserved: boolean;
  schemaDiff: {
    addedFields: string[];
    removedFields: string[];
    modifiedFields: string[];
  };
}
