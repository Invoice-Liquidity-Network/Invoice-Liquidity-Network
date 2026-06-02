import express, { Request, Response } from 'express';
import {
  getFreelancerStats,
  getInvoiceById,
  getInvoiceHistory,
  getLPStats,
  getProtocolStats,
  getTopLPs,
  queryInvoices,
} from './db';

/**
 * Build and return the Express application.
 * Calling this as a factory (rather than exporting a singleton) makes
 * the app trivially injectable in tests.
 */
export function createApp(): express.Application {
  const app = express();
  app.use(express.json());

  // ── GET /health ────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // ── GET /invoices ──────────────────────────────────────────────────────────
  // Supported query parameters (all optional, ANDed together):
  //   ?status=Pending|Funded|Paid|Defaulted
  //   ?freelancer=G...
  //   ?payer=G...
  //   ?funder=G...
  app.get('/invoices', (req: Request, res: Response) => {
    const { status, freelancer, payer, funder } = req.query;

    const invoices = queryInvoices({
      status: typeof status === 'string' ? status : undefined,
      freelancer: typeof freelancer === 'string' ? freelancer : undefined,
      payer: typeof payer === 'string' ? payer : undefined,
      funder: typeof funder === 'string' ? funder : undefined,
    });

    res.json({ invoices });
  });

  app.get('/stats', (_req: Request, res: Response) => {
    res.json(getProtocolStats());
  });

  app.get('/lps/top', (req: Request, res: Response) => {
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 10;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;
    const period = typeof req.query.period === 'string' ? req.query.period : 'all';

    if (!['all', 'week', 'month'].includes(period)) {
      res.status(400).json({ error: 'Invalid period - expected all, week, or month' });
      return;
    }

    res.json(getTopLPs(limit, period));
  });

  app.get('/lps/:address/stats', (req: Request, res: Response) => {
    res.json(getLPStats(req.params.address));
  });

  app.get('/freelancers/:address/stats', (req: Request, res: Response) => {
    res.json(getFreelancerStats(req.params.address));
  });

  app.get('/history/:address', (req: Request, res: Response) => {
    const role = typeof req.query.role === 'string' ? req.query.role : 'freelancer';

    if (role !== 'freelancer' && role !== 'payer' && role !== 'funder') {
      res.status(400).json({ error: 'Invalid role - expected freelancer, payer, or funder' });
      return;
    }

    res.json(getInvoiceHistory(req.params.address, role));
  });

  // ── GET /invoice/:id ───────────────────────────────────────────────────────
  app.get('/invoice/:id', (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid invoice ID - must be a positive integer' });
      return;
    }

    const invoice = getInvoiceById(id);
    if (!invoice) {
      res.status(404).json({ error: `Invoice #${id} not found` });
      return;
    }

    res.json({ invoice });
  });

  return app;
}
