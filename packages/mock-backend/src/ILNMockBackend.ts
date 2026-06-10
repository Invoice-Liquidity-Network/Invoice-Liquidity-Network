import { MockInvoiceClient } from "./mock-invoice-client.js";
import { MockGovernanceClient } from "./mock-governance-client.js";
import { MockReputationClient } from "./mock-reputation-client.js";

import type {
  GovernanceClient,
  InvoiceClient,
  PayerScore,
  Proposal,
  ProtocolParameters,
  ReputationClient,
} from "./types.js";

import type { Invoice } from "./types.js";

export interface ILNMockBackendOptions {
  /** Override the seed invoice set. */
  invoices?: Invoice[];
  /** Override the seed reputation map. */
  reputation?: Map<string, PayerScore>;
  /** Override the seed governance proposals. */
  proposals?: Proposal[];
  /** Override the seed protocol parameters. */
  protocolParams?: ProtocolParameters;
  /** Simulated ILN voting power for the connected wallet. Default: 1,250. */
  votingPower?: number;
}

/**
 * ILNMockBackend
 * ──────────────
 * Single entry-point that creates and wires together all three in-memory
 * clients. Use it in the frontend when `ILN_MOCK=1` is set:
 *
 * ```ts
 * import { ILNMockBackend } from "@iln/mock-backend";
 *
 * const mock = new ILNMockBackend();
 *
 * // Drop-in for soroban.ts helpers:
 * const invoices = await mock.invoice.getAllInvoices();
 * const score    = await mock.reputation.getPayerScore(address);
 * const proposals = await mock.governance.fetchProposals();
 * ```
 *
 * All three clients satisfy the shared interfaces (`InvoiceClient`,
 * `ReputationClient`, `GovernanceClient`) so they can be substituted
 * wherever the real implementations are used.
 */
export class ILNMockBackend {
  /** Handles all invoice read/write operations. */
  readonly invoice: InvoiceClient;

  /** Handles payer reputation reads. */
  readonly reputation: ReputationClient;

  /** Handles governance proposals, voting, and protocol parameters. */
  readonly governance: GovernanceClient;

  constructor(options: ILNMockBackendOptions = {}) {
    this.invoice = new MockInvoiceClient({
      invoices: options.invoices,
      reputation: options.reputation,
    });

    this.reputation = new MockReputationClient({
      scores: options.reputation,
    });

    this.governance = new MockGovernanceClient({
      proposals: options.proposals,
      protocolParams: options.protocolParams,
      votingPower: options.votingPower,
    });
  }
}
