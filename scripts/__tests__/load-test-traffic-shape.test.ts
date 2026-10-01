import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  diurnalMultiplier,
  isLedgerBurstWindow,
  sampleExponentialDelayMs,
  getInterRequestDelayMs,
  BASE_INTER_REQUEST_DELAY_MS,
  LEDGER_CLOSE_INTERVAL_MS,
  REALISTIC_BURST_WINDOW_MS,
  REALISTIC_DIURNAL_AMPLITUDE,
  REALISTIC_DIURNAL_PERIOD_MS,
  type LoadTestConfig,
} from '../lib/load-test-harness';

function baseConfig(overrides: Partial<LoadTestConfig> = {}): LoadTestConfig {
  return {
    service: 'indexer',
    duration: 10,
    concurrency: 5,
    indexerUrl: 'http://localhost:3001',
    notificationsUrl: 'http://localhost:4001',
    p95Threshold: 500,
    errorThreshold: 2,
    avgThreshold: 200,
    rpsThreshold: 10,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('diurnalMultiplier', () => {
  it('returns 1 (baseline) at the start of the cycle', () => {
    expect(diurnalMultiplier(0, REALISTIC_DIURNAL_PERIOD_MS, REALISTIC_DIURNAL_AMPLITUDE)).toBeCloseTo(1, 5);
  });

  it('peaks at 1 + amplitude a quarter of the way through the cycle', () => {
    const quarter = REALISTIC_DIURNAL_PERIOD_MS / 4;
    expect(diurnalMultiplier(quarter, REALISTIC_DIURNAL_PERIOD_MS, REALISTIC_DIURNAL_AMPLITUDE)).toBeCloseTo(
      1 + REALISTIC_DIURNAL_AMPLITUDE,
      5
    );
  });

  it('troughs at 1 - amplitude three quarters of the way through the cycle', () => {
    const threeQuarters = (3 * REALISTIC_DIURNAL_PERIOD_MS) / 4;
    expect(diurnalMultiplier(threeQuarters, REALISTIC_DIURNAL_PERIOD_MS, REALISTIC_DIURNAL_AMPLITUDE)).toBeCloseTo(
      1 - REALISTIC_DIURNAL_AMPLITUDE,
      5
    );
  });

  it('repeats every period', () => {
    const a = diurnalMultiplier(1234, REALISTIC_DIURNAL_PERIOD_MS);
    const b = diurnalMultiplier(1234 + REALISTIC_DIURNAL_PERIOD_MS, REALISTIC_DIURNAL_PERIOD_MS);
    expect(a).toBeCloseTo(b, 5);
  });
});

describe('isLedgerBurstWindow', () => {
  it('is true immediately after a ledger close', () => {
    expect(isLedgerBurstWindow(0)).toBe(true);
    expect(isLedgerBurstWindow(REALISTIC_BURST_WINDOW_MS - 1)).toBe(true);
  });

  it('is false once the burst window has elapsed within the ledger interval', () => {
    expect(isLedgerBurstWindow(REALISTIC_BURST_WINDOW_MS + 1)).toBe(false);
    expect(isLedgerBurstWindow(LEDGER_CLOSE_INTERVAL_MS - 1)).toBe(false);
  });

  it('cycles with each ledger close', () => {
    expect(isLedgerBurstWindow(LEDGER_CLOSE_INTERVAL_MS)).toBe(true);
    expect(isLedgerBurstWindow(2 * LEDGER_CLOSE_INTERVAL_MS + 10)).toBe(true);
  });
});

describe('sampleExponentialDelayMs', () => {
  it('produces only non-negative delays', () => {
    for (let i = 0; i < 200; i++) {
      expect(sampleExponentialDelayMs(0.5)).toBeGreaterThanOrEqual(0);
    }
  });

  it('averages roughly to 1/rate over many samples', () => {
    const rate = 0.2; // events/ms → mean gap 5ms
    const n = 5000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sampleExponentialDelayMs(rate);
    const mean = sum / n;
    expect(mean).toBeGreaterThan(3.5);
    expect(mean).toBeLessThan(6.5);
  });
});

describe('getInterRequestDelayMs', () => {
  it("uniform mode always returns the fixed base delay, unaffected by elapsed time", () => {
    const config = baseConfig({ trafficShape: 'uniform' });
    expect(getInterRequestDelayMs(config, 0)).toBe(BASE_INTER_REQUEST_DELAY_MS);
    expect(getInterRequestDelayMs(config, 123_456)).toBe(BASE_INTER_REQUEST_DELAY_MS);
  });

  it('defaults to uniform behavior when trafficShape is unset (backward compatible)', () => {
    const config = baseConfig();
    delete (config as any).trafficShape;
    expect(getInterRequestDelayMs(config, 999)).toBe(BASE_INTER_REQUEST_DELAY_MS);
  });

  it('realistic mode produces a shorter average delay inside a ledger burst window than outside it', () => {
    const config = baseConfig({ trafficShape: 'realistic' });
    const n = 500;

    let burstTotal = 0;
    for (let i = 0; i < n; i++) burstTotal += getInterRequestDelayMs(config, 0);

    let quietTotal = 0;
    const quietElapsed = REALISTIC_BURST_WINDOW_MS + 100;
    for (let i = 0; i < n; i++) quietTotal += getInterRequestDelayMs(config, quietElapsed);

    expect(burstTotal / n).toBeLessThan(quietTotal / n);
  });

  it('clamps to a bounded maximum so a worker never stalls indefinitely', () => {
    const config = baseConfig({ trafficShape: 'realistic' });
    for (let i = 0; i < 200; i++) {
      expect(getInterRequestDelayMs(config, i * 37)).toBeLessThanOrEqual(BASE_INTER_REQUEST_DELAY_MS * 20);
    }
  });
});
