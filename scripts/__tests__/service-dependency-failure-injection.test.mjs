import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DependencyFailureInjector } from '../testing/service-dependency-failure-injection.mjs';

describe('Service Dependency Failure Injection Suite (#1328)', () => {
  let injector;

  beforeEach(() => {
    injector = new DependencyFailureInjector();
  });

  it('routes to primary anchor when dependencies are healthy', () => {
    const routing = injector.routeSettlement('USDC-BRL');
    assert.equal(routing.selectedAnchor, 'anchor-primary');
    assert.equal(routing.fallbackUsed, false);
  });

  it('automatically trips circuit breaker and falls back to secondary anchor on primary outage', () => {
    injector.injectAnchorFailure('anchor-primary', 1.0);
    const routing = injector.routeSettlement('USDC-BRL');

    assert.equal(routing.selectedAnchor, 'anchor-secondary');
    assert.equal(routing.fallbackUsed, true);
    assert.match(routing.reason, /in error\/outage state/);
    assert.equal(injector.metrics.circuitBreakerTrips, 1);
    assert.equal(injector.metrics.successfulFallbacks, 1);
  });

  it('trips circuit breaker when error rate exceeds threshold (5%)', () => {
    injector.injectAnchorFailure('anchor-primary', 0.08); // 8% error rate
    const routing = injector.routeSettlement('USDC-BRL');

    assert.equal(routing.selectedAnchor, 'anchor-secondary');
    assert.equal(routing.fallbackUsed, true);
  });

  it('fails over RPC calls to secondary endpoint during network partition', () => {
    injector.injectRpcPartition('rpc-primary');
    const res = injector.executeRpcCall('getLedger');

    assert.equal(res.success, true);
    assert.equal(res.nodeId, 'rpc-fallback');
  });

  it('raises RPC_FAILOVER_EXHAUSTED when all RPC dependencies fail', () => {
    injector.injectRpcPartition('rpc-primary');
    injector.injectRpcPartition('rpc-fallback');

    assert.throws(
      () => injector.executeRpcCall('getLedger'),
      /RPC_FAILOVER_EXHAUSTED/
    );
  });

  it('restores healthy routing and cleans up state after recovery', () => {
    injector.injectAnchorFailure('anchor-primary', 1.0);
    injector.recoverAll();

    const routing = injector.routeSettlement('USDC-BRL');
    assert.equal(routing.selectedAnchor, 'anchor-primary');
    assert.equal(routing.fallbackUsed, false);
  });
});
