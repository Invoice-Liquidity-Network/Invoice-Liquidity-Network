#!/usr/bin/env node

/**
 * Multi-Service Outage Game-Day Simulation Harness (#1105)
 *
 * Simulates simultaneous failure of Indexer and Oracle Service to test
 * runbook containment workflows, flag toggling, and fallback resolution.
 */

export class MultiServiceOutageSimulator {
  constructor() {
    this.indexerStatus = 'healthy';
    this.oracleStatus = 'healthy';
    this.flags = {
      NEXT_PUBLIC_INDEXER_ENABLED: true,
      NEXT_PUBLIC_ORACLE_ENABLED: true,
    };
  }

  triggerSimultaneousOutage() {
    this.indexerStatus = 'down';
    this.oracleStatus = 'down';
    return {
      timestamp: new Date().toISOString(),
      indexerStatus: this.indexerStatus,
      oracleStatus: this.oracleStatus,
      severity: 'SEV-1',
      alert: 'ILNMultiServiceOutage (Simultaneous Indexer + Oracle Failure)',
    };
  }

  executeRunbookContainment() {
    if (this.indexerStatus !== 'down' || this.oracleStatus !== 'down') {
      return { success: false, message: 'No active multi-service outage to contain.' };
    }

    // Step 1: Disable indexer dependency in frontend
    this.flags.NEXT_PUBLIC_INDEXER_ENABLED = false;

    // Step 2: Disable oracle gating in frontend
    this.flags.NEXT_PUBLIC_ORACLE_ENABLED = false;

    return {
      success: true,
      containmentTimeMs: 450,
      flags: { ...this.flags },
      protocolReadState: 'soroban_rpc_direct',
      protocolWriteState: 'direct_contract_fallback',
    };
  }

  restoreServices() {
    this.indexerStatus = 'healthy';
    this.oracleStatus = 'healthy';
    this.flags.NEXT_PUBLIC_INDEXER_ENABLED = true;
    this.flags.NEXT_PUBLIC_ORACLE_ENABLED = true;

    return {
      success: true,
      indexerStatus: this.indexerStatus,
      oracleStatus: this.oracleStatus,
      flags: { ...this.flags },
    };
  }
}
