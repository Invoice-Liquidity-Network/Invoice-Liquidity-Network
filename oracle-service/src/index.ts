import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';

import express, { type Request, type Response, type NextFunction } from 'express';
import { Address } from '@stellar/stellar-sdk';
import { traceMiddleware, withSpan, propagateFetch } from '@iln/opentelemetry';

import { createOracleCache } from './cache';
import { createOracleMetrics } from './metrics';
import { AuditTrail, DEFAULT_AUDIT_RETENTION_MS } from './audit-trail';
import { createAuditStore, type AuditRowStore } from './audit-store';
import { createSigningKeyStore, type OracleSigningKeyStore } from './signer';
import {
  type IndexerInvoiceHistoryEntry,
  type OracleServiceHealth,
  type OracleServiceOptions,
  type OracleVerdictAttestation,
  type OracleVerificationRequest,
  type OracleVerificationResponse,
  type ReputationSnapshot,
} from './types';
import { OracleVerifier, fetchOnChainReputation } from './verifier';

const DEFAULT_PORT = 3010;
const DEFAULT_INDEXER_BASE_URL = 'http://localhost:3001';
const DEFAULT_REQUEST_TIMEOUT_MS = 3500;
const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_MAX_ORACLE_AGE_MS = 5 * 60 * 1000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute
/** How often a running service re-applies the audit retention window. */
const AUDIT_RETENTION_SWEEP_MS = 60 * 60 * 1000;

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function createAbortSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return controller.signal;
}

interface RateLimitStore {
  windowStart: number;
  count: number;
}

function createRateLimitMiddleware(
  windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS,
  maxRequests: number = DEFAULT_RATE_LIMIT_MAX_REQUESTS
) {
  const store = new Map<string, RateLimitStore>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIp = (req.ip || req.socket.remoteAddress || 'unknown').toString();
    const now = Date.now();
    const storedEntry = store.get(clientIp);

    if (!storedEntry || now - storedEntry.windowStart > windowMs) {
      store.set(clientIp, { windowStart: now, count: 1 });
      next();
      return;
    }

    storedEntry.count += 1;
    if (storedEntry.count > maxRequests) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((storedEntry.windowStart + windowMs - now) / 1000),
      });
      return;
    }

    next();
  };
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetch(
    url,
    propagateFetch({
      headers: {
        Accept: 'application/json',
      },
      signal: createAbortSignal(timeoutMs),
    } as any),
  );

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

function isValidStellarAddress(value: string): boolean {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  const trimmed = value.trim();
  try {
    Address.fromString(trimmed);
    return true;
  } catch {
    return (
      /^[GCA][A-Z0-9]{50,56}$/.test(trimmed) ||
      /^GTEST[A-Z0-9_:-]*$/.test(trimmed) ||
      /^[A-Z0-9_:-]{3,64}$/.test(trimmed)
    );
  }
}

function parseVerifiedBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * Resolve the key store used to attest published verdicts (#1053).
 *
 * Signing is optional outside production so the service keeps booting in tests
 * and local dev, but an unsigned oracle is exactly the mainnet risk the issue
 * is about, so `NODE_ENV=production` refuses to start without a key instead of
 * publishing verdicts nobody can attribute.
 */
function resolveSigningKeyStore(
  options: Partial<OracleServiceOptions>
): OracleSigningKeyStore | null {
  if (options.signingKeyStore !== undefined) return options.signingKeyStore;

  if (!process.env.ORACLE_SIGNING_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'oracle-service refuses to start in production without ORACLE_SIGNING_KEY: ' +
          'unattributable verdicts cannot be verified by the caller that releases funds'
      );
    }
    return null;
  }
  return createSigningKeyStore();
}

/**
 * Sign one publication. The attestation covers the verdict body as serialised
 * here, so `payload` is what the consumer must compare against — re-marshalling
 * the JSON elsewhere would not reproduce the signed bytes.
 */
function attestVerdict(
  store: OracleSigningKeyStore,
  response: OracleVerificationResponse
): OracleVerdictAttestation {
  const { attestation: _ignored, ...verdict } = response;
  return store.sign(JSON.stringify(verdict), randomUUID());
}

const AUDIT_MAX_PAGE = 1000;

interface AuditQueryParams {
  from?: string;
  to?: string;
  payer?: string;
  invoiceId?: string;
  limit?: number;
  offset?: number;
}

function parseTimestampParam(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Validate the audit query string.
 *
 * Bounds on `limit` matter as much as the filters: the trail is designed to hold
 * a year of every publication, so an unbounded page would let one request make
 * the service read the whole dataset into memory.
 */
function parseAuditQuery(
  query: Record<string, unknown>
): AuditQueryParams | { error: string } {
  const params: AuditQueryParams = {};

  for (const [name, key] of [
    ['from', 'from'],
    ['to', 'to'],
  ] as const) {
    const raw = query[name];
    if (raw === undefined || raw === '') continue;
    const normalized = parseTimestampParam(String(raw));
    if (!normalized) return { error: `${key} must be an ISO-8601 timestamp` };
    params[key] = normalized;
  }

  if (params.from && params.to && params.from > params.to) {
    return { error: 'from must not be after to' };
  }

  const payer = query.payer;
  if (typeof payer === 'string' && payer.trim()) {
    const trimmed = payer.trim();
    if (!isValidStellarAddress(trimmed)) {
      return { error: 'payer must be a valid Stellar address' };
    }
    params.payer = trimmed;
  }

  const invoiceId = query.invoiceId;
  if (invoiceId !== undefined && invoiceId !== '') params.invoiceId = String(invoiceId);

  const limit = Number(query.limit === undefined || query.limit === '' ? AUDIT_MAX_PAGE : query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_MAX_PAGE) {
    return { error: `limit must be an integer between 1 and ${AUDIT_MAX_PAGE}` };
  }
  params.limit = limit;

  const offset = Number(query.offset === undefined || query.offset === '' ? 0 : query.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    return { error: 'offset must be a non-negative integer' };
  }
  params.offset = offset;

  return params;
}

function normalizeHistoryEntry(entry: Record<string, unknown>): IndexerInvoiceHistoryEntry {
  return {
    id: Number(entry.id ?? 0),
    freelancer: String(entry.freelancer ?? ''),
    payer: String(entry.payer ?? ''),
    amount: String(entry.amount ?? '0'),
    due_date: Number(entry.due_date ?? 0),
    discount_rate: Number(entry.discount_rate ?? 0),
    status: String(entry.status ?? 'Pending') as IndexerInvoiceHistoryEntry['status'],
    funder: entry.funder ? String(entry.funder) : null,
    funded_at:
      entry.funded_at === null || entry.funded_at === undefined ? null : Number(entry.funded_at),
    created_at: Number(entry.created_at ?? 0),
    updated_at: Number(entry.updated_at ?? 0),
  };
}

function createDefaultOptions(options: Partial<OracleServiceOptions> = {}): OracleServiceOptions {
  return {
    port: options.port ?? Number(process.env.ORACLE_PORT ?? DEFAULT_PORT),
    indexerBaseUrl:
      options.indexerBaseUrl ?? process.env.INDEXER_BASE_URL ?? DEFAULT_INDEXER_BASE_URL,
    reputationRpcUrl: options.reputationRpcUrl ?? process.env.ORACLE_REPUTATION_RPC_URL,
    reputationContractId: options.reputationContractId ?? process.env.ORACLE_REPUTATION_CONTRACT_ID,
    cacheTtlSeconds:
      options.cacheTtlSeconds ??
      Number(process.env.ORACLE_CACHE_TTL_SECONDS ?? DEFAULT_CACHE_TTL_SECONDS),
    requestTimeoutMs:
      options.requestTimeoutMs ??
      Number(process.env.ORACLE_REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS),
    maxOracleAgeMs:
      options.maxOracleAgeMs ??
      Number(process.env.ORACLE_MAX_ORACLE_AGE_MS ?? DEFAULT_MAX_ORACLE_AGE_MS),
    redisUrl: options.redisUrl ?? process.env.REDIS_URL,
    rateLimitWindowMs:
      options.rateLimitWindowMs ??
      Number(process.env.ORACLE_RATE_LIMIT_WINDOW_MS ?? DEFAULT_RATE_LIMIT_WINDOW_MS),
    rateLimitMaxRequests:
      options.rateLimitMaxRequests ??
      Number(process.env.ORACLE_RATE_LIMIT_MAX_REQUESTS ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS),
    enableRateLimit: options.enableRateLimit ?? process.env.ORACLE_ENABLE_RATE_LIMIT !== 'false',
  };
}

async function createHistoryProvider(baseUrl: string, timeoutMs: number) {
  const normalized = stripTrailingSlash(baseUrl);
  return async (payer: string): Promise<IndexerInvoiceHistoryEntry[]> => {
    try {
      const url = new URL(`/v1/history/${encodeURIComponent(payer)}`, normalized);
      url.searchParams.set('role', 'payer');
      const payload = await fetchJson<unknown>(url.toString(), timeoutMs);
      if (!Array.isArray(payload)) {
        return [];
      }
      return payload.map((entry) => normalizeHistoryEntry(entry as Record<string, unknown>));
    } catch (error) {
      // Re-thrown rather than swallowed into `[]`: "this payer has no invoices"
      // and "we could not read the feed" are different facts, and collapsing them
      // loses the only in-band signal that the assessment was computed blind.
      // `OracleVerifier` already runs this through `Promise.allSettled`, so a
      // rejection still degrades to empty history — it just also records the
      // documented "Indexer data unavailable" evidence. The transport-level chaos
      // suite (#1058) is what proves the two paths stay distinguishable.
      const errorMessage = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.warn(`[oracle] indexer unavailable for payer ${payer}: ${errorMessage}`);
      throw error;
    }
  };
}

async function createReputationProvider(
  options: OracleServiceOptions
): Promise<(payer: string) => Promise<ReputationSnapshot>> {
  if (!options.reputationRpcUrl || !options.reputationContractId) {
    return async (payer: string) => ({
      address: payer,
      score: 0,
      totalPaid: 0n,
      invoiceCount: 0,
      lastActivity: 0,
      rank: 0,
    });
  }

  return async (payer: string) =>
    fetchOnChainReputation(
      {
        rpcUrl: options.reputationRpcUrl!,
        contractId: options.reputationContractId!,
        networkPassphrase: process.env.ORACLE_NETWORK_PASSPHRASE,
        source: process.env.ORACLE_RPC_SOURCE,
      },
      payer
    );
}

export interface CreateOracleAppResult {
  app: express.Express;
  close(): Promise<void>;
  health(): OracleServiceHealth;
  /**
   * Exposed so the HTTP server can schedule retention; tests use it to inspect
   * what was recorded without going through the read routes.
   */
  auditTrail: AuditTrail;
}

export async function createOracleApp(
  options: Partial<OracleServiceOptions> = {}
): Promise<CreateOracleAppResult> {
  const resolved = createDefaultOptions(options);
  const metrics = createOracleMetrics();
  const cache = options.cache
    ? { cache: options.cache, kind: 'memory' as const, close: async () => {} }
    : await createOracleCache({
        redisUrl: resolved.redisUrl,
        ttlSeconds: resolved.cacheTtlSeconds,
      });
  const historyProvider =
    options.historyProvider ??
    (await createHistoryProvider(resolved.indexerBaseUrl, resolved.requestTimeoutMs));
  const reputationProvider =
    options.reputationProvider ?? (await createReputationProvider(resolved));
  const verifier = new OracleVerifier({
    cache: cache.cache,
    historyProvider,
    reputationProvider,
    // Absent until an external KYB provider is wired up; the composition
    // policy treats that as `unknown` and leaves confidence untouched.
    externalProvider: options.externalProvider,
    kybProvider: options.kybProvider,
    cacheTtlSeconds: resolved.cacheTtlSeconds,
    maxOracleAgeMs: resolved.maxOracleAgeMs,
  });

  // Issues #1053 and #1055: a published verdict has to be attributable (an
  // attestation the caller can verify without trusting the transport) and it
  // has to leave a durable record behind. Both are constructed here rather than
  // lazily so a misconfiguration fails at boot, not on the first request.
  const auditStore: AuditRowStore = options.auditStore ?? (await createAuditStore());
  const auditTrail = new AuditTrail({
    store: auditStore,
    retentionMs: options.auditRetentionMs ?? DEFAULT_AUDIT_RETENTION_MS,
  });
  const signerStore = resolveSigningKeyStore(options);

  // Retention is a privacy obligation rather than a cleanup convenience:
  // `docs/privacy.md` §4 caps oracle attestation logs at one year. Enforced at
  // boot and then hourly, so an out-of-window entry is never held simply
  // because the process has not restarted.
  await auditTrail.enforceRetention();
  const retentionTimer = setInterval(() => {
    void auditTrail.enforceRetention().catch((error: unknown) => {
      console.error('[oracle] audit retention sweep failed', error);
    });
  }, AUDIT_RETENTION_SWEEP_MS);
  retentionTimer.unref?.();

  const startedAt = Date.now();
  let lastVerificationAt: string | null = null;
  let healthy = true;

  const app = express();
  app.set('trust proxy', 1);
  // Distributed tracing — W3C traceparent propagation
  app.use(traceMiddleware('oracle-service'));

  // Apply rate limiting middleware if enabled
  if (resolved.enableRateLimit) {
    app.use(createRateLimitMiddleware(resolved.rateLimitWindowMs, resolved.rateLimitMaxRequests));
  }

  app.use(express.json({ limit: '256kb' }));

  app.get('/health', async (_req: Request, res: Response) => {
    res.json({
      ...health(),
      route: '/health',
    });
  });

  app.get('/v1/health', async (_req: Request, res: Response) => {
    res.json({
      ...health(),
      route: '/v1/health',
    });
  });

  app.get('/metrics', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
  });

  app.get('/v1/metrics', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
  });

  app.post('/verify', async (req: Request, res: Response) => {
    await handleVerification(req, res);
  });

  app.post('/v1/verify', async (req: Request, res: Response) => {
    await handleVerification(req, res);
  });

  app.get('/v1/verify', async (_req: Request, res: Response) => {
    res.status(405).json({ error: 'Use POST /v1/verify' });
  });

  /**
   * Which key ids attestations currently carry, and until when the previous key
   * is still honoured (#1053).
   *
   * Rotation cannot be zero-downtime if verifiers have to be told out-of-band
   * which key id to expect, so the service publishes its own rotation state.
   */
  app.get('/v1/signing/config', async (_req: Request, res: Response) => {
    if (!signerStore) {
      res.status(503).json({ error: 'Oracle signing is not configured' });
      return;
    }
    res.json(signerStore.getPublicConfig());
  });

  /**
   * Express 4 does not forward a rejected async handler to its error middleware:
   * the request simply hangs until the client gives up and the failure surfaces
   * as an unhandled process rejection. Every audit route reads from a store that
   * can reject or meet a corrupt row, so each one runs inside this wrapper and a
   * storage fault becomes a 500 like any other.
   */
  function auditRoute(
    handler: (req: Request, res: Response) => Promise<void>
  ): (req: Request, res: Response) => Promise<void> {
    return async (req: Request, res: Response) => {
      try {
        await handler(req, res);
      } catch (error) {
        res.status(500).json({
          error: 'Oracle audit query failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
  }

  /**
   * Query the audit trail by time range and/or feed (#1055).
   *
   * `total` counts the rows matching the filters, not the whole trail, so a
   * caller paging through one payer's history can tell when it has run out.
   *
   * Read-only and, like `/metrics`, intended for operators and auditors: expose
   * it on the same network boundary as the rest of the admin surface rather than
   * to the public listener.
   */
  app.get(
    '/v1/audit/entries',
    auditRoute(async (req: Request, res: Response) => {
      const query = parseAuditQuery(req.query as Record<string, unknown>);
      if ('error' in query) {
        res.status(400).json({ error: query.error });
        return;
      }
      const [entries, total] = await Promise.all([
        auditTrail.getEntries(query),
        auditTrail.count(query),
      ]);
      res.json({ total, retainedForMs: auditTrail.retentionWindowMs, entries });
    })
  );

  /**
   * Recompute the whole hash chain and every entry's HMAC.
   *
   * Reported fields are deliberately non-sensitive: counts and sequence numbers
   * only, never payer addresses, so this can sit behind a looser boundary than
   * the entries endpoint.
   */
  app.get(
    '/v1/audit/integrity',
    auditRoute(async (_req: Request, res: Response) => {
      const result = await auditTrail.verifyIntegrity();
      // A broken chain is an incident, not a query result: it is counted so the
      // existing alert rules can watch it without someone polling this endpoint.
      if (!result.valid) metrics.auditIntegrityFailureTotal.inc();
      res.status(result.valid ? 200 : 500).json(result);
    })
  );

  /**
   * Drop every cached verdict for a payer.
   *
   * The indexer calls this when it observes new activity for a payer, so a
   * cached clean verdict cannot outlive the behaviour it was computed from.
   */
  app.post('/v1/cache/invalidate', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const payer = String(body.payer ?? '').trim();

    if (!payer || !isValidStellarAddress(payer)) {
      res.status(400).json({ error: 'payer must be a valid Stellar address' });
      return;
    }

    const invalidated = await verifier.invalidatePayer(payer);
    res.json({ payer, invalidated });
  });

  async function handleVerification(req: Request, res: Response): Promise<void> {
    const body = (req.body ?? {}) as Partial<OracleVerificationRequest> & Record<string, unknown>;
    const payer = String(body.payer ?? '').trim();
    const amount = body.amount ?? body.invoiceAmount;
    const invoiceId = body.invoiceId ?? body.invoice_id;

    if (!payer || !amount || invoiceId === undefined || invoiceId === null) {
      res.status(400).json({
        error: 'payer, amount, and invoiceId are required',
      });
      return;
    }

    if (!isValidStellarAddress(payer)) {
      res.status(400).json({ error: 'payer must be a valid Stellar address' });
      return;
    }

    metrics.verificationTotal.inc();
    const start = process.hrtime.bigint();

    try {
      const response = await withSpan(
        'oracle.verify',
        { payer: payer.slice(0, 8), invoiceId: String(invoiceId) },
        async () =>
          verifier.verify({
            payer,
            amount,
            invoiceId,
            requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
            forceRefresh: parseVerifiedBoolean(body.forceRefresh),
            maxOracleAgeMs:
              typeof body.maxOracleAgeMs === 'number' ? body.maxOracleAgeMs : resolved.maxOracleAgeMs,
          }),
      );

      metrics.verificationDuration.observe(Number(process.hrtime.bigint() - start) / 1e9);
      if (response.cacheHit) {
        metrics.cacheHitsTotal.inc();
      } else {
        metrics.cacheMissesTotal.inc();
      }
      if (!response.isVerified && response.dataAgeMs > resolved.maxOracleAgeMs) {
        metrics.staleResponsesTotal.inc();
      }

      // Outcome distribution is what the fraud-spike alert watches: a sudden
      // shift toward rejected-fraud-signals means either an attack or a broken
      // heuristic, and both need to be seen immediately.
      metrics.recordVerificationOutcome({
        outcome: response.composition.outcome,
        fraudSignals: response.fraudSignals,
        externalStatus: response.composition.external.status,
        cacheHit: response.cacheHit,
      });

      lastVerificationAt = response.generatedAt;

      // #1055: the trail is written before the response leaves the process, and
      // an append failure fails the request. A verdict that is served but not
      // recorded is precisely the forensic gap the issue exists to close.
      await auditTrail.append(response);

      // #1053: attestation is minted per publication rather than cached with the
      // verdict, so a consumer's replay cache counts publications, not verdicts.
      res.json(
        signerStore
          ? { ...response, attestation: attestVerdict(signerStore, response) }
          : response
      );
    } catch (error) {
      healthy = false;
      metrics.verificationDuration.observe(Number(process.hrtime.bigint() - start) / 1e9);
      res.status(500).json({
        error: 'Oracle verification failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function health(): OracleServiceHealth {
    return {
      status: healthy ? 'ok' : 'degraded',
      uptimeMs: Date.now() - startedAt,
      cache: cache.kind,
      indexerBaseUrl: resolved.indexerBaseUrl,
      reputationConfigured: Boolean(resolved.reputationRpcUrl && resolved.reputationContractId),
      lastVerificationAt,
      signing: signerStore ? 'enabled' : 'disabled',
      audit: auditStore.kind,
    };
  }

  return {
    app,
    close: async () => {
      clearInterval(retentionTimer);
      await cache.close();
      await auditTrail.close();
    },
    health,
    auditTrail,
  };
}

/**
 * Boot the HTTP server.
 *
 * Resolves once the socket is listening and hands back the server, so callers
 * (and tests) can shut it down deterministically rather than leaking a handle.
 */
export async function startOracleService(
  options: Partial<OracleServiceOptions> = {}
): Promise<Server> {
  const { app } = await createOracleApp(options);
  const resolved = createDefaultOptions(options);

  return new Promise<Server>((resolve) => {
    const server = app.listen(resolved.port, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : resolved.port;
      console.log(`[oracle] listening on http://0.0.0.0:${port}`);
      resolve(server);
    });
  });
}

const shouldAutostart =
  process.env.NODE_ENV !== 'test' && process.env.ORACLE_DISABLE_AUTOSTART !== 'true';
if (shouldAutostart) {
  void startOracleService().catch((error) => {
    console.error('[oracle] failed to start', error);
    process.exitCode = 1;
  });
}

export type {
  ExternalVerificationProvider,
  ExternalVerificationResult,
  OracleServiceOptions,
  OracleSignalComposition,
  OracleVerificationRequest,
  OracleVerificationResponse,
  KYBVerificationResult,
  VerificationProvider,
  ReputationSnapshot,
  IndexerInvoiceHistoryEntry,
} from './types';
export { composeVerdict, COMPOSITION_POLICY_VERSION } from './composition';
export {
  OracleVerifier,
  assessOracleRequest,
  normalizeAmountToNumber,
  normalizeTimestampToMs,
  fetchOnChainReputation,
} from './verifier';
export { MockKYBProvider } from './kyb/mockProvider';
