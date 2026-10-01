import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runRpcOutageDrillScenario, MockRPCEndpointManager } from '../drills/rpc-outage-drill.mjs';

describe('RPC-Node Outage System Drill Suite (#1107)', () => {
  it('automatically fails over from unreachable primary RPC to healthy secondary RPC', async () => {
    const manager = runRpcOutageDrillScenario();
    const result = await manager.executeRpcRequest({ method: 'getLatestLedger' });

    assert.equal(result.success, true);
    assert.equal(result.endpointUrl, 'https://soroban-backup.stellar.org');
    assert.equal(result.failoverAttempts, 1);
    assert.ok(result.durationMs > 0);
  });

  it('throws RPC_FAILOVER_EXHAUSTED when all configured RPC endpoints are down', async () => {
    const allDownManager = new MockRPCEndpointManager([
      { url: 'https://primary.rpc', isHealthy: false, latencyMs: 100 },
      { url: 'https://backup.rpc', isHealthy: false, latencyMs: 100 },
    ]);

    await assert.rejects(
      async () => {
        await allDownManager.executeRpcRequest({ method: 'getHealth' });
      },
      (err) => {
        assert.ok(err.message.includes('RPC_FAILOVER_EXHAUSTED'));
        return true;
      }
    );
  });
});
