import client, { type Registry } from 'prom-client';

export interface OracleMetrics {
  registry: Registry;
  verificationTotal: client.Counter<string>;
  cacheHitsTotal: client.Counter<string>;
  cacheMissesTotal: client.Counter<string>;
  staleResponsesTotal: client.Counter<string>;
  verificationDuration: client.Histogram<string>;
}

export function createOracleMetrics(): OracleMetrics {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const verificationTotal = new client.Counter({
    name: 'oracle_verification_requests_total',
    help: 'Total number of oracle verification requests received',
    registers: [registry],
  });

  const cacheHitsTotal = new client.Counter({
    name: 'oracle_cache_hits_total',
    help: 'Total number of oracle cache hits',
    registers: [registry],
  });

  const cacheMissesTotal = new client.Counter({
    name: 'oracle_cache_misses_total',
    help: 'Total number of oracle cache misses',
    registers: [registry],
  });

  const staleResponsesTotal = new client.Counter({
    name: 'oracle_stale_responses_total',
    help: 'Total number of stale oracle responses returned',
    registers: [registry],
  });

  const verificationDuration = new client.Histogram({
    name: 'oracle_verification_duration_seconds',
    help: 'Oracle verification latency in seconds',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  return {
    registry,
    verificationTotal,
    cacheHitsTotal,
    cacheMissesTotal,
    staleResponsesTotal,
    verificationDuration,
  };
}
