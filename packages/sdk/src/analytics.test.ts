import { describe, it, expect, vi, beforeEach, type Mocked } from 'vitest';
import axios from 'axios';
import { AnalyticsSDK } from '../src/analytics';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

describe('AnalyticsSDK', () => {
  let sdk: AnalyticsSDK;

  beforeEach(() => {
    sdk = new AnalyticsSDK('https://api.test', 1000); // 1s TTL for testing
    vi.clearAllMocks();
  });

  it('should fetch protocol stats and cache them', async () => {
    const mockStats = { totalInvoices: 10, totalVolume: 1000n, totalYield: 50n, defaultRate: 0.1 };
    mockedAxios.get.mockResolvedValue({ data: mockStats });

    const stats1 = await sdk.getProtocolStats();
    expect(stats1).toEqual(mockStats);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    const stats2 = await sdk.getProtocolStats();
    expect(stats2).toEqual(mockStats);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1); // Should be from cache
  });

  it('should fetch from server again after TTL expires', async () => {
    const mockStats = { totalInvoices: 10, totalVolume: 1000n, totalYield: 50n, defaultRate: 0.1 };
    mockedAxios.get.mockResolvedValue({ data: mockStats });

    await sdk.getProtocolStats();
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    // Wait for TTL (1s)
    await new Promise(resolve => setTimeout(resolve, 1100));

    await sdk.getProtocolStats();
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('should fetch history for different roles', async () => {
    const mockHistory = [{ id: '1', status: 'Paid' }];
    mockedAxios.get.mockResolvedValue({ data: mockHistory });

    await sdk.getInvoiceHistory('addr1', 'freelancer');
    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.test/history/addr1?role=freelancer');

    await sdk.getInvoiceHistory('addr1', 'payer');
    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.test/history/addr1?role=payer');
  });

  it('should fetch LP stats', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { invoiceCount: 5 } });
    const data = await sdk.getLPStats('G123');
    expect(data.invoiceCount).toBe(5);
    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.test/lps/G123/stats');
  });

  it('should fetch freelancer stats', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { submitted: 10 } });
    const data = await sdk.getFreelancerStats('G123');
    expect(data.submitted).toBe(10);
    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.test/freelancers/G123/stats');
  });

  it('should fetch top LPs', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [{ address: 'G123' }] });
    const data = await sdk.getTopLPs(5, 'month');
    expect(data[0].address).toBe('G123');
    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.test/lps/top?limit=5&period=month');
  });

  it('should clear cache', async () => {
    mockedAxios.get.mockResolvedValue({ data: { totalInvoices: 10 } });
    await sdk.getProtocolStats();
    sdk.clearCache();
    await sdk.getProtocolStats();
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });
});
