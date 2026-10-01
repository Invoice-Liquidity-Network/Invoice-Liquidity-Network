import express, { Request, Response, Router, RequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import crypto from 'crypto';
import { traceMiddleware, withSpan } from '@iln/opentelemetry';
import {
  getDb,
  getFreelancerStats,
  getInvoiceById,
  getInvoiceHistory,
  getLPStats,
  getProtocolStats,
  getTopLPs,
  queryInvoicesPaginated,
  getCursorUpdatedAt,
} from './db';
import { cacheGet, cacheSet } from './cache';
import { openApiSpec } from './openapi';
import { createGraphQLHandler } from './graphql';
import { createApiRateLimiter } from './rateLimit';
import {
  getArchiveStats,
  queryArchiveInvoices,
  queryArchiveEvents,
  restoreInvoice,
  archiveOldData,
} from './archive';
import { getDashboardMetrics, recordRequest, recordError } from './dashboard';
import { BackupManager } from './backup';
import { observeHttpRequest, registry as metricsRegistry } from './metrics';
import {
  SYNC_EXPORT_LIMIT,
  countInvoicesForExport,
  countEventsForExport,
  invoiceIdAtOffset,
  eventLedgerAtOffset,
  exportSessionBudget,
  exportPageMaxRows,
  decodeExportCursor,
  encodeExportCursor,
  streamInvoicesExport,
  streamEventsExport,
  createExportJob,
  getExportJob,
  getExportContent,
  processExportJob,
  type ExportFilter,
  type EventExportFilter,
  type ExportFormat,
  type ExportSink,
  type ExportType,
} from './export';

/**
 * Build and return the Express application.
 * Calling this as a factory (rather than exporting a singleton) makes
 * the app trivially injectable in tests.
 */
export function createApp(): express.Application {
  const app = express();
  // Trust the first hop's X-Forwarded-For (e.g. Railway's proxy) so
  // per-IP rate limiting sees real client IPs rather than the proxy's.
  app.set('trust proxy', 1);
  // Distributed tracing — W3C traceparent propagation across indexer/oracle/notifications
  app.use(traceMiddleware('indexer'));
  app.use(createApiRateLimiter());
  app.use(express.json());

  // Prometheus metrics endpoint — also exposed as /v1/metrics for consistency
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });
  app.get('/v1/metrics', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });

  // ── GraphQL (queries, mutations, subscriptions via SSE + GraphiQL) ──────────
  const yoga = createGraphQLHandler();
  app.use('/graphql', yoga);

  // ── Swagger / OpenAPI docs ─────────────────────────────────────────────────
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: 'ILN Indexer API Docs',
      swaggerOptions: { defaultModelsExpandDepth: -1 },
    })
  );

  const startTime = Date.now();
  const backupManager = new BackupManager();

  // ── Version negotiation ────────────────────────────────────────────────────
  // If the client sends Accept: application/vnd.iln.v1+json or API-Version: 1
  // we echo back API-Version: 1 so callers can detect which version served them.
  const versionNegotiate: RequestHandler = (req, res, next) => {
    const accept = req.get('Accept') ?? '';
    const apiVersion = req.get('API-Version') ?? '';
    if (
      (accept.includes('application/vnd.iln.v1+json') || apiVersion === '1') &&
      !req.path.startsWith('/v1')
    ) {
      res.setHeader('API-Version', '1');
    }
    next();
  };

  const addV1Headers: RequestHandler = (_req, res, next) => {
    res.setHeader('API-Version', '1');
    next();
  };

  // Unversioned routes are kept for backward compat but carry deprecation signals.
  const addDeprecationHeaders: RequestHandler = (_req, res, next) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', 'Sat, 01 Jan 2026 00:00:00 GMT');
    next();
  };

  const trackMetrics: RequestHandler = (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      recordRequest(duration);
      if (res.statusCode >= 400) {
        recordError(`${res.statusCode}`, `${req.method} ${req.path} returned ${res.statusCode}`);
      }
      // SLO & cost instrumentation — latency SLI and per-request cost attribution
      const route = (req.route?.path as string) ?? req.path;
      observeHttpRequest(req.method, route, res.statusCode, duration / 1000);
    });
    next();
  };

  // ── CDN / edge-caching helpers ─────────────────────────────────────────────
  //
  // Each endpoint declares a staleness tolerance via Cache-Control. A CDN
  // (Cloudflare, Fastly, CloudFront) honours these headers to serve stale-
  // while-revalidate responses at the edge, reducing origin load and global
  // read latency.
  //
  // Staleness classes (informed by docs/indexer-data-model.md):
  //
  //   immutable    — terminal invoice state, never changes
  //   short-lived  — aggregated stats, tolerate 10-30 s staleness
  //   dynamic      — per-request data, no edge caching (private)
  //   health       — operational, no caching

  /** Set CDN-friendly Cache-Control headers. */
  const cacheControl = (
    res: Response,
    profile: 'health' | 'dynamic' | 'short' | 'medium' | 'long'
  ) => {
    switch (profile) {
      case 'health':
        res.setHeader('Cache-Control', 'no-store');
        break;
      case 'dynamic':
        // Private — browsers may cache briefly, CDN must not
        res.setHeader('Cache-Control', 'private, no-cache');
        break;
      case 'short':
        // 10s CDN, 30s stale-while-revalidate for stats endpoints
        res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=10, stale-while-revalidate=30');
        break;
      case 'medium':
        // 30s CDN, 60s stale-while-revalidate for list/history endpoints
        res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30, stale-while-revalidate=60');
        break;
      case 'long':
        // 5min CDN for rarely-changing data (top LPs over "all" period)
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
        break;
    }
  };

  // ── Shared route handlers ──────────────────────────────────────────────────
  const router = Router();

  // GET /health
  router.get('/health', (_req: Request, res: Response) => {
    let dbStatus: 'ok' | 'error' = 'ok';
    let lastSyncMs: number | null = null;
    try {
      getDb().prepare('SELECT 1').get();
      lastSyncMs = getCursorUpdatedAt();
    } catch {
      dbStatus = 'error';
    }

    cacheControl(res, 'health');
    res.status(dbStatus === 'ok' ? 200 : 503).json({
      status: dbStatus,
      db: dbStatus,
      lastSync: lastSyncMs !== null ? new Date(lastSyncMs).toISOString() : null,
      uptime: Date.now() - startTime,
    });
  });

  // GET /invoices
  // Supported query parameters (all optional, ANDed together):
  //   ?status=Pending|Funded|Paid|Defaulted
  //   ?freelancer=G...
  //   ?payer=G...
  //   ?funder=G...
  //   ?limit=10 (default 100 max) & ?cursor=opaque
  router.get('/invoices', async (req: Request, res: Response) => {
    const { status, freelancer, payer, funder, limit: rawLimit, cursor } = req.query;

    const s = typeof status === 'string' ? status : '';
    const fl = typeof freelancer === 'string' ? freelancer : '';
    const pa = typeof payer === 'string' ? payer : '';
    const fu = typeof funder === 'string' ? funder : '';
    const limit = typeof rawLimit === 'string' ? Math.min(parseInt(rawLimit, 10) || 100, 100) : 100;
    
    // Hash query parameters to prevent cache key collisions and poisoning
    const params = { s, fl, pa, fu, limit, cursor: cursor ?? '' };
    const hash = crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex');
    const cacheKey = `invoices:${hash}`;

    const cached = await cacheGet(cacheKey);
    if (cached) {
      cacheControl(res, 'medium');
      res.json(JSON.parse(cached));
      return;
    }

    const { invoices, hasMore, nextCursor } = queryInvoicesPaginated(
      {
        status: s || undefined,
        freelancer: fl || undefined,
        payer: pa || undefined,
        funder: fu || undefined,
      },
      limit,
      typeof cursor === 'string' ? cursor : undefined
    );

    const result = { invoices, hasMore, nextCursor };
    await cacheSet(cacheKey, JSON.stringify(result));
    cacheControl(res, 'medium');
    res.json(result);
  });

  router.get('/stats', (_req: Request, res: Response) => {
    cacheControl(res, 'short');
    res.json(getProtocolStats());
  });

  router.get('/lps/top', (req: Request, res: Response) => {
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 10;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;
    const period = typeof req.query.period === 'string' ? req.query.period : 'all';

    if (!['all', 'week', 'month'].includes(period)) {
      res.status(400).json({ error: 'Invalid period - expected all, week, or month' });
      return;
    }

    // "all" period changes rarely; week/month are more dynamic
    cacheControl(res, period === 'all' ? 'long' : 'short');
    res.json(getTopLPs(limit, period));
  });

  router.get('/lps/:address/stats', (req: Request, res: Response) => {
    cacheControl(res, 'short');
    res.json(getLPStats(req.params.address));
  });

  router.get('/freelancers/:address/stats', (req: Request, res: Response) => {
    cacheControl(res, 'short');
    res.json(getFreelancerStats(req.params.address));
  });

  router.get('/history/:address', (req: Request, res: Response) => {
    const role = typeof req.query.role === 'string' ? req.query.role : 'freelancer';

    if (role !== 'freelancer' && role !== 'payer' && role !== 'funder') {
      res.status(400).json({
        error: 'Invalid role - expected freelancer, payer, or funder',
      });
      return;
    }

    // Optional field projection: ?fields=id,amount,status,due_date
    // Reduces payload size when consumers only need a subset of columns.
    const rawFields = typeof req.query.fields === 'string' ? req.query.fields : undefined;
    const fields = rawFields
      ? rawFields.split(',').map((f) => f.trim()).filter(Boolean)
      : undefined;

    cacheControl(res, 'medium');
    res.json(getInvoiceHistory(req.params.address, role, fields));
  });

  // GET /invoice/:id
  router.get('/invoice/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid invoice ID - must be a positive integer' });
      return;
    }

    const cacheKey = `invoice:${id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      cacheControl(res, 'medium');
      res.json(JSON.parse(cached));
      return;
    }

    const invoice = getInvoiceById(id);
    if (!invoice) {
      res.status(404).json({ error: `Invoice #${id} not found` });
      return;
    }

    const result = { invoice };
    await cacheSet(cacheKey, JSON.stringify(result));
    cacheControl(res, 'medium');
    res.json(result);
  });

  // GET /dashboard
  router.get('/dashboard', (_req: Request, res: Response) => {
    cacheControl(res, 'short');
    res.json(getDashboardMetrics());
  });

  // GET /archive/stats
  router.get('/archive/stats', (_req: Request, res: Response) => {
    res.json(getArchiveStats());
  });

  // GET /archive/invoices
  router.get('/archive/invoices', (req: Request, res: Response) => {
    const { status, freelancer, payer, funder } = req.query;
    const filter = {
      status: typeof status === 'string' ? status : undefined,
      freelancer: typeof freelancer === 'string' ? freelancer : undefined,
      payer: typeof payer === 'string' ? payer : undefined,
      funder: typeof funder === 'string' ? funder : undefined,
    };
    res.json({ invoices: queryArchiveInvoices(filter) });
  });

  // GET /archive/events
  router.get('/archive/events', (req: Request, res: Response) => {
    const invoiceId =
      typeof req.query.invoiceId === 'string' ? parseInt(req.query.invoiceId, 10) : undefined;
    res.json({
      events: queryArchiveEvents(
        invoiceId !== undefined && isNaN(invoiceId) ? undefined : invoiceId
      ),
    });
  });

  // POST /archive/restore/:id
  router.post('/archive/restore/:id', (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid invoice ID - must be a positive integer' });
      return;
    }
    const success = restoreInvoice(id);
    if (!success) {
      res.status(404).json({ error: `Invoice #${id} not found in archive` });
      return;
    }
    res.json({
      success: true,
      message: `Invoice #${id} and associated events restored successfully`,
    });
  });

  // POST /archive/run
  router.post('/archive/run', (req: Request, res: Response) => {
    const olderThanDays = typeof req.body?.olderThanDays === 'number' ? req.body.olderThanDays : 90;
    try {
      const result = archiveOldData(olderThanDays);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Archival run failed' });
    }
  });

  // ── Backup endpoints ──────────────────────────────────────────────────────

  app.post('/backup', async (_req: Request, res: Response) => {
    try {
      const manifest = await backupManager.runBackup();
      if (manifest) {
        res.json({ success: true, backup: manifest });
      } else {
        res.status(500).json({ error: 'Backup failed' });
      }
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Backup failed',
      });
    }
  });

  // GET /backup — list backups
  app.get('/backup', (_req: Request, res: Response) => {
    const backups = backupManager.listBackups();
    res.json({ backups, total: backups.length });
  });

  // GET /backup/latest — get the latest backup manifest
  app.get('/backup/latest', (_req: Request, res: Response) => {
    const latest = backupManager.getLatestBackup();
    if (latest) {
      res.json(latest);
    } else {
      res.status(404).json({ error: 'No backups found' });
    }
  });

  // POST /backup/restore — restore from a backup
  app.post('/backup/restore', async (req: Request, res: Response) => {
    const { backupPath, verify } = req.body;

    if (!backupPath || typeof backupPath !== 'string') {
      res.status(400).json({ error: 'backupPath is required' });
      return;
    }

    try {
      await backupManager.restore({ backupPath, verify: verify !== false });
      res.json({ success: true, message: 'Restore complete' });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Restore failed',
      });
    }
  });

  // ── Export endpoints ───────────────────────────────────────────────────────

  /**
   * Shared guard for the synchronous export routes: enforces the
   * count-first SYNC limit, the cumulative session row budget, and emits
   * resumption headers when the budget will cut the response short.
   * Returns the effective per-response row budget, or null when a 413 was sent.
   */
  const prepareExportStream = (
    res: Response,
    remainingCount: number,
    rowsBefore: number,
    computeCursor: (rowBudget: number) => string | undefined
  ): { budget: ReturnType<typeof exportSessionBudget>; rowBudget: number } | null => {
    const budget = exportSessionBudget();
    const sessionRowsLeft = budget.maxRows - rowsBefore;
    if (sessionRowsLeft <= 0) {
      res.status(413).json({
        error: `Export session row budget exhausted (${budget.maxRows} cumulative rows). Start a new session by omitting the cursor.`,
        limit: budget.maxRows,
      });
      return null;
    }
    if (remainingCount > SYNC_EXPORT_LIMIT) {
      res.status(413).json({
        error: `Result set too large (${remainingCount} rows). Use POST /export/jobs for async export.`,
        count: remainingCount,
        limit: SYNC_EXPORT_LIMIT,
      });
      return null;
    }
    const rowBudget = Math.min(exportPageMaxRows(), sessionRowsLeft);
    if (remainingCount > rowBudget) {
      const cursor = computeCursor(rowBudget);
      if (cursor) {
        res.setHeader('X-Export-Truncated', 'true');
        res.setHeader('X-Export-Resumption-Cursor', cursor);
      }
    }
    return { budget, rowBudget };
  };

  // GET /export/invoices?format=csv|json&from=ISO&to=ISO&status=...&freelancer=...&payer=...&funder=...&cursor=...
  router.get('/export/invoices', (req: Request, res: Response) => {
    const format = (req.query.format === 'csv' ? 'csv' : 'json') as ExportFormat;
    const filter: ExportFilter = {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      freelancer: typeof req.query.freelancer === 'string' ? req.query.freelancer : undefined,
      payer: typeof req.query.payer === 'string' ? req.query.payer : undefined,
      funder: typeof req.query.funder === 'string' ? req.query.funder : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    };

    if (filter.from && isNaN(new Date(filter.from).getTime())) {
      res.status(400).json({ error: "Invalid 'from' date — expected ISO 8601 format" });
      return;
    }
    if (filter.to && isNaN(new Date(filter.to).getTime())) {
      res.status(400).json({ error: "Invalid 'to' date — expected ISO 8601 format" });
      return;
    }

    const cursor = decodeExportCursor(filter.cursor);
    const rowsBefore = cursor?.rowsBefore ?? 0;
    const remaining = countInvoicesForExport(filter);
    const prepared = prepareExportStream(res, remaining, rowsBefore, (rowBudget) => {
      const lastId = invoiceIdAtOffset(filter, rowBudget - 1);
      return lastId === undefined
        ? undefined
        : encodeExportCursor(lastId, rowsBefore + rowBudget);
    });
    if (!prepared) return;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="invoices.json"');
    }
    streamInvoicesExport(res as unknown as ExportSink, filter, format, {
      maxRows: prepared.rowBudget,
      maxBytes: prepared.budget.maxBytes,
      maxMs: prepared.budget.maxMs,
      rowsBefore,
    });
    res.end();
  });

  // GET /export/events?format=csv|json&from=ISO&to=ISO&invoiceId=...&cursor=...
  router.get('/export/events', (req: Request, res: Response) => {
    const format = (req.query.format === 'csv' ? 'csv' : 'json') as ExportFormat;
    const rawInvoiceId =
      typeof req.query.invoiceId === 'string' ? parseInt(req.query.invoiceId, 10) : undefined;
    const filter: EventExportFilter = {
      invoiceId: rawInvoiceId !== undefined && !isNaN(rawInvoiceId) ? rawInvoiceId : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    };

    if (filter.from && isNaN(new Date(filter.from).getTime())) {
      res.status(400).json({ error: "Invalid 'from' date — expected ISO 8601 format" });
      return;
    }
    if (filter.to && isNaN(new Date(filter.to).getTime())) {
      res.status(400).json({ error: "Invalid 'to' date — expected ISO 8601 format" });
      return;
    }

    const cursor = decodeExportCursor(filter.cursor);
    const rowsBefore = cursor?.rowsBefore ?? 0;
    const remaining = countEventsForExport(filter);
    const prepared = prepareExportStream(res, remaining, rowsBefore, (rowBudget) => {
      const lastLedger = eventLedgerAtOffset(filter, rowBudget - 1);
      return lastLedger === undefined
        ? undefined
        : encodeExportCursor(lastLedger, rowsBefore + rowBudget);
    });
    if (!prepared) return;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="events.csv"');
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="events.json"');
    }
    streamEventsExport(res as unknown as ExportSink, filter, format, {
      maxRows: prepared.rowBudget,
      maxBytes: prepared.budget.maxBytes,
      maxMs: prepared.budget.maxMs,
      rowsBefore,
    });
    res.end();
  });

  // POST /export/jobs — create an async export job
  // Body: { type: "invoices"|"events", format: "csv"|"json", from?, to?, status?, freelancer?, payer?, funder?, invoiceId?, cursor? }
  router.post('/export/jobs', (req: Request, res: Response) => {
    const {
      type,
      format,
      from,
      to,
      status,
      freelancer,
      payer,
      funder,
      invoiceId,
      cursor,
    } = req.body ?? {};

    if (type !== 'invoices' && type !== 'events') {
      res.status(400).json({ error: "type must be 'invoices' or 'events'" });
      return;
    }
    if (format !== 'csv' && format !== 'json') {
      res.status(400).json({ error: "format must be 'csv' or 'json'" });
      return;
    }
    if (from && isNaN(new Date(from).getTime())) {
      res.status(400).json({ error: "Invalid 'from' date — expected ISO 8601 format" });
      return;
    }
    if (to && isNaN(new Date(to).getTime())) {
      res.status(400).json({ error: "Invalid 'to' date — expected ISO 8601 format" });
      return;
    }

    const filter =
      type === 'invoices'
        ? ({
            status,
            freelancer,
            payer,
            funder,
            from,
            to,
            cursor: typeof cursor === 'string' ? cursor : undefined,
          } as ExportFilter)
        : ({
            invoiceId: typeof invoiceId === 'number' ? invoiceId : undefined,
            from,
            to,
            cursor: typeof cursor === 'string' ? cursor : undefined,
          } as EventExportFilter);

    const job = createExportJob(type as ExportType, format as ExportFormat, filter);

    // Start processing in the background after the response is sent.
    setImmediate(() => void processExportJob(job.jobId));

    res.status(202).json({
      jobId: job.jobId,
      status: job.status,
      type: job.type,
      format: job.format,
      createdAt: job.createdAt,
      downloadUrl: `/v1/export/download/${job.jobId}`,
    });
  });

  // GET /export/jobs/:jobId — poll job status
  router.get('/export/jobs/:jobId', (req: Request, res: Response) => {
    const job = getExportJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Export job not found' });
      return;
    }
    res.json({
      jobId: job.jobId,
      type: job.type,
      format: job.format,
      status: job.status,
      createdAt: job.createdAt,
      completedAt: job.completedAt ?? null,
      rowCount: job.rowCount ?? null,
      truncated: job.truncated ?? false,
      resumptionCursor: job.resumptionCursor ?? null,
      error: job.error ?? null,
      downloadUrl: job.status === 'done' ? `/v1/export/download/${job.jobId}` : null,
    });
  });

  // GET /export/download/:jobId — stream the completed export
  router.get('/export/download/:jobId', (req: Request, res: Response) => {
    const job = getExportJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Export job not found' });
      return;
    }
    if (job.status === 'pending' || job.status === 'processing') {
      res.status(202).json({ error: 'Export not ready yet', status: job.status });
      return;
    }
    if (job.status === 'failed') {
      res.status(500).json({ error: job.error ?? 'Export failed' });
      return;
    }

    const content = getExportContent(req.params.jobId);
    if (content === undefined) {
      res.status(500).json({ error: 'Export content unavailable' });
      return;
    }

    const filename = `${job.type}.${job.format}`;
    if (job.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (job.truncated) {
      res.setHeader('X-Export-Truncated', 'true');
      if (job.resumptionCursor) {
        res.setHeader('X-Export-Resumption-Cursor', job.resumptionCursor);
      }
    }
    res.send(content);
  });

  // Catch-all 404 inside the router so a missing /v1/* route doesn't fall
  // through to the root mount and get processed a second time.
  router.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Mount routes ───────────────────────────────────────────────────────────
  app.use(trackMetrics);
  app.use(versionNegotiate);
  app.use('/v1', addV1Headers, router);
  app.use(addDeprecationHeaders, router);

  return app;
}
