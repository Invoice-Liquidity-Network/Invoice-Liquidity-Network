#!/usr/bin/env node

/**
 * RPC-Node Outage System Drill Simulator (#1107)
 *
 * Simulates primary Soroban RPC provider outage and measures failover & recovery
 * across SDK, indexer, and oracle-service.
 */

export class MockRPCEndpointManager {
  constructor(endpoints) {
    this.endpoints = endpoints; // Array of { url, isHealthy, latencyMs }
    this.currentIndex = 0;
  }

  async executeRpcRequest(requestPayload) {
    const startTime = Date.now();
    let attempts = 0;

    while (attempts < this.endpoints.length) {
      const endpoint = this.endpoints[this.currentIndex];
      attempts++;

      if (endpoint.isHealthy) {
        const duration = Date.now() - startTime + endpoint.latencyMs;
        return {
          success: true,
          endpointUrl: endpoint.url,
          failoverAttempts: attempts - 1,
          durationMs: duration,
          data: { result: 'soroban_rpc_success', payload: requestPayload },
        };
      }

      // Failover to next endpoint
      this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    }

    throw new Error(`RPC_FAILOVER_EXHAUSTED: All ${this.endpoints.length} Soroban RPC endpoints are unreachable.`);
  }
}

export function runRpcOutageDrillScenario() {
  const endpoints = [
    { url: 'https://soroban-primary.stellar.org', isHealthy: false, latencyMs: 500 }, // Primary DOWN
    { url: 'https://soroban-backup.stellar.org', isHealthy: true, latencyMs: 120 },   // Fallback HEALTHY
  ];

  const manager = new MockRPCEndpointManager(endpoints);
  return manager;
}
