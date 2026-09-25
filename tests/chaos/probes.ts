import type { ExpectationCheck, ProbeName } from './scenarios';

/** One observation of one probe. */
export interface Sample {
  probe: ProbeName;
  at: number;
  status: number | null;
  latencyMs: number;
  body: unknown;
  error?: string;
}

export interface Endpoints {
  oracleUrl: string;
  indexerUrl: string;
  notificationsUrl: string;
}

export const DEFAULT_ENDPOINTS: Endpoints = {
  oracleUrl: process.env.CHAOS_ORACLE_URL ?? 'http://localhost:3010',
  indexerUrl: process.env.CHAOS_INDEXER_URL ?? 'http://localhost:3001',
  notificationsUrl: process.env.CHAOS_NOTIFICATIONS_URL ?? 'http://localhost:4001',
};

const PROBE_TIMEOUT_MS = 8_000;
const CANARY_PAYER =
  process.env.CHAOS_CANARY_PAYER ?? 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';

export type ProbeFn = (endpoints: Endpoints) => Promise<Sample>;

async function observe(probe: ProbeName, url: string, init?: RequestInit): Promise<Sample> {
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON body is kept as text */
    }
    return { probe, at: started, status: response.status, latencyMs: Date.now() - started, body };
  } catch (err) {
    return {
      probe,
      at: started,
      status: null,
      latencyMs: Date.now() - started,
      body: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const PROBES: Record<ProbeName, ProbeFn> = {
  oracleHealth: (e) => observe('oracleHealth', `${e.oracleUrl}/v1/health`),
  oracleVerify: (e) =>
    observe('oracleVerify', `${e.oracleUrl}/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payer: CANARY_PAYER, amount: '1000000' }),
    }),
  indexerHealth: (e) => observe('indexerHealth', `${e.indexerUrl}/health`),
  notificationsHealth: (e) => observe('notificationsHealth', `${e.notificationsUrl}/health`),
  notificationsProviders: (e) =>
    observe('notificationsProviders', `${e.notificationsUrl}/health/providers`),
};

function readPath(body: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        typeof acc === 'object' && acc !== null ? (acc as Record<string, unknown>)[key] : undefined,
      body
    );
}

/** Pure: does one sample satisfy a check? */
export function evaluate(check: ExpectationCheck, sample: Sample): boolean {
  switch (check.kind) {
    case 'status':
      return sample.status !== null && check.anyOf.includes(sample.status);
    case 'no5xx':
      return sample.status !== null && sample.status < 500;
    case 'latencyBelowMs':
      return sample.status !== null && sample.latencyMs < check.ms;
    case 'jsonField':
      return check.anyOf.includes(readPath(sample.body, check.path));
  }
}
