import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MultiServiceOutageSimulator } from '../game-days/simulate-multi-service-outage.mjs';

describe('Multi-Service Outage Game-Day Suite (#1105)', () => {
  it('simulates simultaneous indexer and oracle-service outage and verifies containment', () => {
    const sim = new MultiServiceOutageSimulator();

    const outageReport = sim.triggerSimultaneousOutage();
    assert.equal(outageReport.severity, 'SEV-1');
    assert.equal(outageReport.indexerStatus, 'down');
    assert.equal(outageReport.oracleStatus, 'down');

    const containment = sim.executeRunbookContainment();
    assert.equal(containment.success, true);
    assert.equal(containment.flags.NEXT_PUBLIC_INDEXER_ENABLED, false);
    assert.equal(containment.flags.NEXT_PUBLIC_ORACLE_ENABLED, false);
    assert.equal(containment.protocolReadState, 'soroban_rpc_direct');

    const recovery = sim.restoreServices();
    assert.equal(recovery.success, true);
    assert.equal(recovery.indexerStatus, 'healthy');
    assert.equal(recovery.oracleStatus, 'healthy');
    assert.equal(recovery.flags.NEXT_PUBLIC_INDEXER_ENABLED, true);
  });
});
