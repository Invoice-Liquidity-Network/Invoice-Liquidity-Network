import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SettlementCircuitBreaker, CIRCUIT_STATES } from '../operations/circuit-breaker-controller.mjs';

describe('Settlement Circuit Breaker Suite (#1307)', () => {
  it('trips to OPEN state when consecutive failure threshold is exceeded', () => {
    const cb = new SettlementCircuitBreaker({ failureThreshold: 3 });
    assert.equal(cb.state, CIRCUIT_STATES.CLOSED);

    cb.recordTransactionOutcome(false, 'SEP-31 503 Service Unavailable');
    cb.recordTransactionOutcome(false, 'SEP-31 503 Service Unavailable');
    assert.equal(cb.state, CIRCUIT_STATES.CLOSED);

    cb.recordTransactionOutcome(false, 'SEP-31 503 Service Unavailable');
    assert.equal(cb.state, CIRCUIT_STATES.OPEN);
    assert.equal(cb.getState().isRoutingAllowed, false);
  });

  it('rejects settlements while circuit is OPEN and cool-off has not elapsed', () => {
    const cb = new SettlementCircuitBreaker({ failureThreshold: 1, coolOffDurationMs: 5000 });
    cb.recordTransactionOutcome(false, 'Error');
    assert.equal(cb.state, CIRCUIT_STATES.OPEN);

    assert.throws(
      () => cb.recordTransactionOutcome(true),
      /CIRCUIT_OPEN: Corridor/
    );
  });

  it('transitions through HALF_OPEN and resets to CLOSED after consecutive probe successes', async () => {
    const cb = new SettlementCircuitBreaker({ failureThreshold: 1, successThreshold: 2, coolOffDurationMs: 50 });
    cb.recordTransactionOutcome(false, 'Failure');
    assert.equal(cb.state, CIRCUIT_STATES.OPEN);

    // Wait for cool-off
    await new Promise((r) => setTimeout(r, 60));

    // First probe -> transitions to HALF_OPEN
    cb.recordTransactionOutcome(true);
    assert.equal(cb.state, CIRCUIT_STATES.HALF_OPEN);

    // Second probe -> satisfies successThreshold (2) -> resets to CLOSED
    cb.recordTransactionOutcome(true);
    assert.equal(cb.state, CIRCUIT_STATES.CLOSED);
    assert.equal(cb.getState().isRoutingAllowed, true);
  });

  it('supports emergency manual trip and reset by incident commander', () => {
    const cb = new SettlementCircuitBreaker();
    cb.forceManualTrip('Emergency freeze');
    assert.equal(cb.state, CIRCUIT_STATES.OPEN);

    cb.forceManualReset('Incident mitigated');
    assert.equal(cb.state, CIRCUIT_STATES.CLOSED);
  });
});
