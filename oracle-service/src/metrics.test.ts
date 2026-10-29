import { describe, expect, it } from 'vitest';

import { FRAUD_RATIO_WINDOW, createOracleMetrics } from './metrics';

/** Pull a single metric's samples out of the registry. */
async function sample(
  metrics: ReturnType<typeof createOracleMetrics>,
  name: string
): Promise<{ value: number; labels: Record<string, string | number> }[]> {
  const found = (await metrics.registry.getMetricsAsJSON()).find((m) => m.name === name);
  return (found?.values ?? []) as { value: number; labels: Record<string, string | number> }[];
}

describe('oracle metrics registry', () => {
  it('exposes every metric the monitoring pipeline scrapes', async () => {
    const metrics = createOracleMetrics();
    const exposition = await metrics.registry.metrics();

    for (const name of [
      'oracle_verification_requests_total',
      'oracle_cache_hits_total',
      'oracle_cache_misses_total',
      'oracle_stale_responses_total',
      'oracle_verification_duration_seconds',
      'oracle_verification_outcome_total',
      'oracle_fraud_signal_total',
      'oracle_fraud_flag_ratio',
      'oracle_external_verification_total',
    ]) {
      expect(exposition).toContain(name);
    }
  });

  it('collects process defaults alongside the service metrics', async () => {
    const metrics = createOracleMetrics();
    expect(await metrics.registry.metrics()).toContain('process_cpu_user_seconds_total');
  });
});

describe('recordVerificationOutcome', () => {
  it('partitions verdicts by outcome, external status and cache hit', async () => {
    const metrics = createOracleMetrics();

    metrics.recordVerificationOutcome({
      outcome: 'verified-both',
      fraudSignals: [],
      externalStatus: 'verified',
      cacheHit: false,
    });

    const values = await sample(metrics, 'oracle_verification_outcome_total');
    expect(values).toHaveLength(1);
    expect(values[0].labels).toEqual({
      outcome: 'verified-both',
      external_status: 'verified',
      cache_hit: 'false',
    });
    expect(values[0].value).toBe(1);
  });

  it('counts each fraud heuristic separately so a spike can be attributed', async () => {
    const metrics = createOracleMetrics();

    metrics.recordVerificationOutcome({
      outcome: 'rejected-fraud-signals',
      fraudSignals: ['Rapid succession', 'Similar amounts'],
      externalStatus: 'unknown',
      cacheHit: false,
    });

    const values = await sample(metrics, 'oracle_fraud_signal_total');
    expect(values.map((v) => v.labels.signal).sort()).toEqual([
      'Rapid succession',
      'Similar amounts',
    ]);
  });

  it('tracks external provider status distribution', async () => {
    const metrics = createOracleMetrics();

    for (const status of ['verified', 'verified', 'unverified', 'unknown']) {
      metrics.recordVerificationOutcome({
        outcome: 'verified-both',
        fraudSignals: [],
        externalStatus: status,
        cacheHit: false,
      });
    }

    const values = await sample(metrics, 'oracle_external_verification_total');
    const byStatus = Object.fromEntries(values.map((v) => [v.labels.status, v.value]));
    expect(byStatus).toEqual({ verified: 2, unverified: 1, unknown: 1 });
  });
});

describe('fraud flag ratio', () => {
  function record(
    metrics: ReturnType<typeof createOracleMetrics>,
    flagged: boolean,
    cacheHit = false
  ): void {
    metrics.recordVerificationOutcome({
      outcome: flagged ? 'rejected-fraud-signals' : 'verified-heuristic-only',
      fraudSignals: flagged ? ['Rapid succession'] : [],
      externalStatus: 'unknown',
      cacheHit,
    });
  }

  it('starts at zero before any verdict', async () => {
    const metrics = createOracleMetrics();
    expect((await sample(metrics, 'oracle_fraud_flag_ratio'))[0]?.value ?? 0).toBe(0);
  });

  it('reports the share of flagged verdicts', async () => {
    const metrics = createOracleMetrics();

    record(metrics, true);
    record(metrics, false);
    record(metrics, false);
    record(metrics, false);

    expect((await sample(metrics, 'oracle_fraud_flag_ratio'))[0].value).toBe(0.25);
  });

  it('reaches 1 when every verdict is flagged — the attack signature', async () => {
    const metrics = createOracleMetrics();
    for (let i = 0; i < 10; i += 1) record(metrics, true);

    expect((await sample(metrics, 'oracle_fraud_flag_ratio'))[0].value).toBe(1);
  });

  it('excludes cache hits, so one payer retrying cannot skew the ratio', async () => {
    const metrics = createOracleMetrics();

    record(metrics, false);
    // Twenty replays of the same flagged verdict from cache.
    for (let i = 0; i < 20; i += 1) record(metrics, true, true);

    expect((await sample(metrics, 'oracle_fraud_flag_ratio'))[0].value).toBe(0);
  });

  it('still counts cache hits in the outcome counter', async () => {
    const metrics = createOracleMetrics();
    record(metrics, true, true);

    const values = await sample(metrics, 'oracle_verification_outcome_total');
    expect(values[0].labels.cache_hit).toBe('true');
  });

  it('slides the window so old verdicts stop counting', async () => {
    const metrics = createOracleMetrics();

    for (let i = 0; i < FRAUD_RATIO_WINDOW; i += 1) record(metrics, true);
    expect((await sample(metrics, 'oracle_fraud_flag_ratio'))[0].value).toBe(1);

    for (let i = 0; i < FRAUD_RATIO_WINDOW; i += 1) record(metrics, false);
    expect((await sample(metrics, 'oracle_fraud_flag_ratio'))[0].value).toBe(0);
  });
});
