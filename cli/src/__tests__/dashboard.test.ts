import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Dashboard } from '../dashboard';

// Mock dependencies
vi.mock('../client', () => ({
  ILNClient: vi.fn().mockImplementation(() => ({
    // Mock client methods
  })),
}));

describe('Dashboard', () => {
  let dashboard: Dashboard;
  let mockClient: any;
  let mockConfig: any;

  beforeEach(() => {
    mockClient = {};
    mockConfig = {
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractId: 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC',
    };

    dashboard = new Dashboard(mockClient, mockConfig, {
      refreshIntervalMs: 1000,
      maxItems: 10,
    });
  });

  afterEach(() => {
    dashboard.stop();
  });

  describe('constructor', () => {
    it('should create an instance with default config', () => {
      const d = new Dashboard(mockClient, mockConfig);
      expect(d).toBeDefined();
    });

    it('should create an instance with custom config', () => {
      const d = new Dashboard(mockClient, mockConfig, {
        refreshIntervalMs: 2000,
        maxItems: 50,
      });
      expect(d).toBeDefined();
    });
  });

  describe('exportData', () => {
    it('should return dashboard data', () => {
      const data = dashboard.exportData();
      expect(data).toBeDefined();
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('network');
      expect(data).toHaveProperty('stats');
      expect(data).toHaveProperty('invoices');
      expect(data).toHaveProperty('activity');
    });

    it('should include network from config', () => {
      const data = dashboard.exportData() as any;
      expect(data.network).toBe('testnet');
    });
  });

  describe('state', () => {
    it('should have initial state', () => {
      const data = dashboard.exportData() as any;
      expect(data.invoices).toEqual([]);
      expect(data.activity).toEqual([]);
    });
  });
});
