import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildErrorRatioQuery,
  buildLatencyQuery,
  parseInstantVectorValue,
} from '../canary/prometheus-adapter.mjs';
import { getPolicy } from '../canary/policy.mjs';

describe('buildErrorRatioQuery', () => {
  it('scopes the query to deployment=canary and the given service label', () => {
    const query = buildErrorRatioQuery(getPolicy('indexer'), 'indexer');
    assert.match(query, /deployment="canary"/);
    assert.match(query, /service="indexer"/);
    assert.match(query, /iln_http_errors_total/);
    assert.match(query, /iln_http_requests_total/);
  });

  it('uses the oracle-service-specific metric names', () => {
    const query = buildErrorRatioQuery(getPolicy('oracle-service'), 'oracle-service');
    assert.match(query, /oracle_stale_responses_total/);
    assert.match(query, /oracle_verification_requests_total/);
  });
});

describe('buildLatencyQuery', () => {
  it('builds a histogram_quantile(0.95, ...) query scoped to the canary', () => {
    const query = buildLatencyQuery(getPolicy('notifications'), 'notifications');
    assert.match(query, /histogram_quantile\(0\.95/);
    assert.match(query, /iln_notifications_delivery_duration_seconds_bucket/);
    assert.match(query, /deployment="canary"/);
  });
});

describe('parseInstantVectorValue', () => {
  it('extracts the numeric value from a well-formed Prometheus response', () => {
    const response = {
      data: { result: [{ metric: {}, value: [1234567890, '0.0042'] }] },
    };
    assert.equal(parseInstantVectorValue(response), 0.0042);
  });

  it('returns 0 for an empty result set (no canary traffic yet)', () => {
    assert.equal(parseInstantVectorValue({ data: { result: [] } }), 0);
  });

  it('returns 0 for a malformed/missing response shape rather than throwing', () => {
    assert.equal(parseInstantVectorValue({}), 0);
    assert.equal(parseInstantVectorValue(undefined), 0);
  });
});
