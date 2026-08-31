import axios from 'axios';

import type { ContractStats, InvoiceState, LPStats } from '@iln/shared';

/** Protocol-level statistics (alias for shared ContractStats type). */
export type ProtocolStats = ContractStats;

/**
 * Freelancer-specific statistics.
 *
 * @property submitted - Total number of invoices submitted.
 * @property funded - Number of invoices that received funding.
 * @property totalReceived - Total amount received after discounts (in smallest unit).
 * @property avgDiscount - Average discount rate across all invoices.
 */
export interface FreelancerStats {
  submitted: number;
  funded: number;
  totalReceived: bigint;
  avgDiscount: number;
}

/**
 * Invoice data as returned by the analytics API.
 */
export interface AnalyticsInvoice {
  id: number;
  freelancer: string;
  payer: string;
  amount: bigint;
  due_date: number;
  discount_rate: number;
  status: InvoiceState;
  funder: string | null;
}

/**
 * Liquidity provider statistics for a single address.
 */
export interface LPStat {
  address: string;
  yield: bigint;
  invoiceCount: number;
}

/**
 * Client for fetching protocol analytics from the ILN API.
 * Provides cached access to protocol stats, LP stats, freelancer stats,
 * invoice history, and top LP rankings.
 *
 * @example
 * ```ts
 * const analytics = new AnalyticsSDK("https://api.iln.network");
 *
 * const stats = await analytics.getProtocolStats();
 * console.log(`Total volume: ${stats.totalVolume}`);
 *
 * const lpStats = await analytics.getLPStats("GABC...");
 * console.log(`Yield earned: ${lpStats.yield}`);
 * ```
 */
export class AnalyticsSDK {
  private baseUrl: string;
  private cache: Map<string, { data: any; timestamp: number }>;
  private defaultTtl: number;

  /**
   * Create a new analytics client.
   * @param baseUrl - The base URL of the ILN analytics API.
   * @param defaultTtl - Default cache TTL in milliseconds (default: 300000 = 5 minutes).
   */
  constructor(baseUrl: string = 'https://api.iln.network', defaultTtl: number = 300000) {
    this.baseUrl = baseUrl;
    this.cache = new Map();
    this.defaultTtl = defaultTtl;
  }

  private async fetchWithCache<T>(
    key: string,
    endpoint: string,
    ttl: number = this.defaultTtl
  ): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && now - cached.timestamp < ttl) {
      return cached.data as T;
    }

    const response = await axios.get(`${this.baseUrl}${endpoint}`);
    const data = this.parseBigInts(response.data);

    this.cache.set(key, { data, timestamp: now });
    return data as T;
  }

  private parseBigInts(value: any): any {
    if (Array.isArray(value)) {
      return value.map((item) => this.parseBigInts(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const parsed: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      if (
        typeof fieldValue === 'string' &&
        ['amount', 'totalVolume', 'totalYield', 'deployed', 'yield', 'totalReceived'].includes(key)
      ) {
        parsed[key] = BigInt(fieldValue);
      } else {
        parsed[key] = this.parseBigInts(fieldValue);
      }
    }

    return parsed;
  }

  /**
   * Fetch protocol-wide statistics (total invoices, volume, yield, default rate).
   *
   * @returns Protocol statistics.
   *
   * @example
   * ```ts
   * const stats = await analytics.getProtocolStats();
   * console.log(`${stats.totalInvoices} invoices, volume: ${stats.totalVolume}`);
   * ```
   */
  async getProtocolStats(): Promise<ProtocolStats> {
    return this.fetchWithCache<ProtocolStats>('protocol-stats', '/stats');
  }

  /**
   * Fetch statistics for a specific liquidity provider.
   *
   * @param address - The Stellar address of the LP.
   * @returns LP-specific statistics including deployed amount, yield, and default rate.
   *
   * @example
   * ```ts
   * const stats = await analytics.getLPStats("GABC...");
   * console.log(`Deployed: ${stats.deployed}, Yield: ${stats.yield}`);
   * ```
   */
  async getLPStats(address: string): Promise<LPStats> {
    return this.fetchWithCache<LPStats>(`lp-stats-${address}`, `/lps/${address}/stats`);
  }

  /**
   * Fetch statistics for a specific freelancer.
   *
   * @param address - The Stellar address of the freelancer.
   * @returns Freelancer-specific statistics.
   *
   * @example
   * ```ts
   * const stats = await analytics.getFreelancerStats("GABC...");
   * console.log(`Submitted: ${stats.submitted}, Funded: ${stats.funded}`);
   * ```
   */
  async getFreelancerStats(address: string): Promise<FreelancerStats> {
    return this.fetchWithCache<FreelancerStats>(
      `freelancer-stats-${address}`,
      `/freelancers/${address}/stats`
    );
  }

  /**
   * Fetch invoice history for a specific address filtered by role.
   *
   * @param address - The Stellar address to query.
   * @param role - Filter invoices by the address's role (freelancer, payer, or funder).
   * @returns Array of invoices matching the filter.
   *
   * @example
   * ```ts
   * const history = await analytics.getInvoiceHistory("GABC...", "freelancer");
   * console.log(`${history.length} invoices submitted`);
   * ```
   */
  async getInvoiceHistory(
    address: string,
    role: 'freelancer' | 'payer' | 'funder'
  ): Promise<AnalyticsInvoice[]> {
    return this.fetchWithCache<AnalyticsInvoice[]>(
      `history-${address}-${role}`,
      `/history/${address}?role=${role}`
    );
  }

  /**
   * Fetch the top liquidity providers ranked by yield.
   *
   * @param limit - Maximum number of LPs to return (default: 10).
   * @param period - Time period to rank by: "all", "week", or "month" (default: "all").
   * @returns Array of LP statistics sorted by yield descending.
   *
   * @example
   * ```ts
   * const topLPs = await analytics.getTopLPs(5, "week");
   * topLPs.forEach(lp => console.log(`${lp.address}: ${lp.yield}`));
   * ```
   */
  async getTopLPs(limit: number = 10, period: 'all' | 'week' | 'month' = 'all'): Promise<LPStat[]> {
    return this.fetchWithCache<LPStat[]>(
      `top-lps-${limit}-${period}`,
      `/lps/top?limit=${limit}&period=${period}`
    );
  }

  /**
   * Clear all cached analytics data.
   * Useful after mutations that affect analytics data.
   */
  clearCache() {
    this.cache.clear();
  }
}
