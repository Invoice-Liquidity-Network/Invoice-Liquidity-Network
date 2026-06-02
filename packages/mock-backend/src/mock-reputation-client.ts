import type { PayerScore, ReputationClient } from "./types.js";
import { SEED_REPUTATION } from "./seed.js";

function delay(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Standalone in-memory {@link ReputationClient}.
 *
 * The {@link MockInvoiceClient} also exposes the same reputation methods — this
 * class exists so the frontend can instantiate a focused reputation client if
 * needed without carrying all invoice state.
 */
export class MockReputationClient implements ReputationClient {
  private readonly scores: Map<string, PayerScore>;

  constructor(options?: { scores?: Map<string, PayerScore> }) {
    this.scores = options?.scores ?? new Map(SEED_REPUTATION);
  }

  async getPayerScore(payerAddress: string): Promise<PayerScore | null> {
    await delay();
    return this.scores.get(payerAddress) ?? null;
  }

  async getPayerScoresBatch(
    addresses: string[]
  ): Promise<Map<string, PayerScore | null>> {
    await delay();
    const result = new Map<string, PayerScore | null>();
    for (const addr of addresses) {
      result.set(addr, this.scores.get(addr) ?? null);
    }
    return result;
  }
}
