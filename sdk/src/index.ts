export * from "./amounts";
export * from "./client";
export * from "./invoice-status";
export * from "./signers";
export * from "./types";
export * from "./timeouts";
export { ContractError } from "./generated/types";
export * from "./notifications";
export * from "./analytics";
export * from "./analytics-computations";
export type { UsageEvent } from "./usage-analytics";
export * from "./compatibility";
export * from "./federation";
export * from "./governance";
export * from "./errors";
export * from "./offline";
export { OfflineQueuePanel } from "./OfflineQueuePanel";
export type {
  OfflineQueueController,
  OfflineQueuePanelProps,
} from "./OfflineQueuePanel";
export * from "./event-emitter";
export * from "./recovery";
export * from "./plugins";
export { InvoiceDashboard } from "./InvoiceDashboard";
export type {
  InvoiceDashboardProps,
  LiveInvoiceEvent,
  InvoiceEventType,
  DashboardMetrics,
  MetricKey,
  DashboardTheme,
} from "./InvoiceDashboard";
export * from "./cache";
export * from "./validators";

export const SDK_VERSION = "0.1.0";

export const NETWORKS = {
  TESTNET: "Test SDF Network ; September 2015",
  MAINNET: "Public Global Stellar Network ; September 2015",
  STANDALONE: "Standalone Network ; September 2022",
} as const;

export const DEFAULT_TIMEOUTS = {
  readMs: 10_000,
  writeMs: 30_000,
  simulationMs: 15_000,
} as const;

export const DEFAULT_CACHE_CONFIG = {
  ttl: 60_000,
  storage: "memory" as const,
  enabled: true,
};

export const INVOICE_STATES = {
  PENDING: "Pending",
  FUNDED: "Funded",
  PAID: "Paid",
  DEFAULTED: "Defaulted",
  DISPUTED: "Disputed",
} as const;

export const TOKENS = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 7,
  },
  EURC: {
    symbol: "EURC",
    name: "Euro Coin",
    decimals: 7,
  },
} as const;
