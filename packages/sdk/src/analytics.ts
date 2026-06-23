import axios from 'axios';

export interface ProtocolStats {
  totalInvoices: number;
  totalVolume: bigint;
  totalYield: bigint;
  defaultRate: number;
}

export interface LPStats {
  deployed: bigint;
  yield: bigint;
  invoiceCount: number;
  defaultRate: number;
}

export interface FreelancerStats {
  submitted: number;
  funded: number;
  totalReceived: bigint;
  avgDiscount: number;
}

export interface AnalyticsInvoice {
  id: number;
  freelancer: string;
  payer: string;
  amount: bigint;
  due_date: number;
  discount_rate: number;
  status: string;
  funder: string | null;
}

export interface LPStat {
  address: string;
  yield: bigint;
  invoiceCount: number;
}

export class AnalyticsSDK {
  private baseUrl: string;
  private cache: Map<string, { data: any; timestamp: number }>;
  private defaultTtl: number;

  constructor(baseUrl: string = 'https://api.iln.network', defaultTtl: number = 300000) {
    this.baseUrl = baseUrl;
    this.cache = new Map();
    this.defaultTtl = defaultTtl;
  }

  private async fetchWithCache<T>(key: string, endpoint: string, ttl: number = this.defaultTtl): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && (now - cached.timestamp < ttl)) {
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

  async getProtocolStats(): Promise<ProtocolStats> {
    return this.fetchWithCache<ProtocolStats>('protocol-stats', '/stats');
  }

  async getLPStats(address: string): Promise<LPStats> {
    return this.fetchWithCache<LPStats>(`lp-stats-${address}`, `/lps/${address}/stats`);
  }

  async getFreelancerStats(address: string): Promise<FreelancerStats> {
    return this.fetchWithCache<FreelancerStats>(`freelancer-stats-${address}`, `/freelancers/${address}/stats`);
  }

  async getInvoiceHistory(address: string, role: 'freelancer' | 'payer' | 'funder'): Promise<AnalyticsInvoice[]> {
    return this.fetchWithCache<AnalyticsInvoice[]>(`history-${address}-${role}`, `/history/${address}?role=${role}`);
  }

  async getTopLPs(limit: number = 10, period: 'all' | 'week' | 'month' = 'all'): Promise<LPStat[]> {
    return this.fetchWithCache<LPStat[]>(`top-lps-${limit}-${period}`, `/lps/top?limit=${limit}&period=${period}`);
  }

  clearCache() {
    this.cache.clear();
  }
}
