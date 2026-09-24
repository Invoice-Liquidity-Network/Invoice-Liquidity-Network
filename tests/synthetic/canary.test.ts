/**
 * tests/synthetic/canary.test.ts
 *
 * Synthetic canary monitoring tests.
 *
 * These tests run against lightweight Node.js http servers and a mock WebSocket
 * client so the suite executes fully offline in CI with ZERO external dependencies.
 * Each logical check is isolated in its own `it` block so failures are pinpointed.
 */

import http from 'node:http';
import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ── Constants & Ports ─────────────────────────────────────────────────────────

const CANARY_INVOICE_ID = 1;
const CANARY_PAYER_ADDRESS = 'GC5GY2JTEOIVJDNFPEZQNMGZBTZJ5LFTJFWL5UB3LV4BGVVQAHC3D4S';

const INDEXER_PORT = 3091;
const NOTIFICATIONS_PORT = 4091;
const NOTIFICATIONS_WS_PORT = 4092;
const ORACLE_PORT = 3191;

const INDEXER_BASE_URL = `http://localhost:${INDEXER_PORT}`;
const NOTIFICATIONS_BASE_URL = `http://localhost:${NOTIFICATIONS_PORT}`;
const ORACLE_BASE_URL = `http://localhost:${ORACLE_PORT}`;
const WS_URL = `ws://localhost:${NOTIFICATIONS_WS_PORT}/ws`;

// ── Mock WebSocket class for offline testing ─────────────────────────────────

class MockWebSocket extends EventEmitter {
  public readyState = 1; // OPEN

  constructor(_url: string) {
    super();
    // Simulate async heartbeat frame delivery after connection
    setTimeout(() => {
      this.emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'heartbeat',
            payload: { clientId: 'mock-canary-client' },
            timestamp: Date.now(),
          }),
        ),
      );
    }, 20);
  }

  send() {}
  close() {
    this.emit('close');
  }
  terminate() {
    this.emit('close');
  }
}

// Install mock WebSocket globally for the test process
(globalThis as any).WebSocket = MockWebSocket;

// ── Set process env BEFORE importing synthetic-canary module ─────────────────

process.env.INDEXER_BASE_URL = INDEXER_BASE_URL;
process.env.NOTIFICATIONS_BASE_URL = NOTIFICATIONS_BASE_URL;
process.env.ORACLE_BASE_URL = ORACLE_BASE_URL;
process.env.NOTIFICATIONS_WS_URL = WS_URL;
process.env.CANARY_INVOICE_ID = String(CANARY_INVOICE_ID);
process.env.CANARY_PAYER_ADDRESS = CANARY_PAYER_ADDRESS;
process.env.CANARY_REQUEST_TIMEOUT_MS = '4000';
process.env.CANARY_WEBHOOK_SUB_ID = '0';

let checkIndexer: typeof import('../../scripts/synthetic-canary').checkIndexer;
let checkNotifications: typeof import('../../scripts/synthetic-canary').checkNotifications;
let checkOracle: typeof import('../../scripts/synthetic-canary').checkOracle;
let runAllCanaryChecks: typeof import('../../scripts/synthetic-canary').runAllCanaryChecks;

// ── HTTP Mock Servers ─────────────────────────────────────────────────────────

let indexerServer: http.Server;
let notificationsServer: http.Server;
let oracleServer: http.Server;

// Controllable server state for testing failure paths
let indexerHealthStatus = 'ok';
let indexerInvoiceNotFound = false;
let notificationsHealthStatus = 'ok';
let oracleHealthStatus = 'ok';
let oracleVerifyStatus = 200;
let oracleCorruptPayload = false;

function createIndexerServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/v1/health') {
      if (indexerHealthStatus !== 'ok') {
        res.writeHead(500);
        res.end(JSON.stringify({ status: indexerHealthStatus }));
        return;
      }
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: 'ok',
          db: 'ok',
          lastSync: new Date().toISOString(),
          uptime: 12345,
        }),
      );
      return;
    }

    if (url.pathname === `/v1/invoice/${CANARY_INVOICE_ID}`) {
      if (indexerInvoiceNotFound) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      res.writeHead(200);
      res.end(
        JSON.stringify({
          invoice: {
            id: CANARY_INVOICE_ID,
            freelancer: 'GFREELANCER',
            payer: CANARY_PAYER_ADDRESS,
            amount: '10000000',
            due_date: Math.floor(Date.now() / 1000) + 86400,
            discount_rate: 300,
            status: 'Pending',
          },
        }),
      );
      return;
    }

    if (url.pathname === '/v1/stats') {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          totalInvoices: 42,
          totalFunded: 30,
          totalPaid: 25,
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

function createNotificationsServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/health') {
      if (notificationsHealthStatus !== 'ok') {
        res.writeHead(500);
        res.end(JSON.stringify({ status: 'degraded' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (url.pathname === '/subscribe') {
      res.writeHead(201);
      res.end(
        JSON.stringify({
          subscription: { id: 999, stellar_address: CANARY_PAYER_ADDRESS },
        }),
      );
      return;
    }

    if (url.pathname === '/test-webhook') {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, statusCode: 200 }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

function createOracleServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/v1/health') {
      if (oracleHealthStatus !== 'ok') {
        res.writeHead(500);
        res.end(JSON.stringify({ status: oracleHealthStatus }));
        return;
      }
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: 'ok',
          uptimeMs: 55000,
          cache: 'memory',
          reputationConfigured: false,
        }),
      );
      return;
    }

    if (url.pathname === '/v1/verify') {
      if (oracleVerifyStatus !== 200) {
        res.writeHead(oracleVerifyStatus);
        res.end(
          JSON.stringify({
            error: 'Oracle verification failed',
            message: 'upstream timeout',
          }),
        );
        return;
      }

      if (oracleCorruptPayload) {
        res.writeHead(200);
        res.end(JSON.stringify({ payer: CANARY_PAYER_ADDRESS }));
        return;
      }

      res.writeHead(200);
      res.end(
        JSON.stringify({
          payer: CANARY_PAYER_ADDRESS,
          isVerified: true,
          trustScore: 85,
          confidenceLevel: 'high',
          cacheHit: false,
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

function listenServer(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve) => server.listen(port, () => resolve()));
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ── Test Lifecycle ────────────────────────────────────────────────────────────

beforeAll(async () => {
  indexerServer = createIndexerServer();
  notificationsServer = createNotificationsServer();
  oracleServer = createOracleServer();

  await Promise.all([
    listenServer(indexerServer, INDEXER_PORT),
    listenServer(notificationsServer, NOTIFICATIONS_PORT),
    listenServer(oracleServer, ORACLE_PORT),
  ]);

  const mod = await import('../../scripts/synthetic-canary');
  checkIndexer = mod.checkIndexer;
  checkNotifications = mod.checkNotifications;
  checkOracle = mod.checkOracle;
  runAllCanaryChecks = mod.runAllCanaryChecks;
});

afterAll(async () => {
  await Promise.all([
    closeServer(indexerServer),
    closeServer(notificationsServer),
    closeServer(oracleServer),
  ]);
});

// ── Indexer Checks ────────────────────────────────────────────────────────────

describe('Indexer synthetic canary checks', () => {
  it('indexer:health — reports status=ok with uptime', async () => {
    indexerHealthStatus = 'ok';
    const results = await checkIndexer();
    const healthCheck = results.find((r) => r.name === 'indexer:health');
    expect(healthCheck).toBeDefined();
    expect(healthCheck?.passed).toBe(true);
    expect(healthCheck?.detail).toMatch(/status=ok/);
  });

  it(`indexer:invoice:${CANARY_INVOICE_ID} — returns correct canary invoice`, async () => {
    indexerInvoiceNotFound = false;
    const results = await checkIndexer();
    const invoiceCheck = results.find((r) =>
      r.name.startsWith('indexer:invoice:'),
    );
    expect(invoiceCheck).toBeDefined();
    expect(invoiceCheck?.passed).toBe(true);
    expect(invoiceCheck?.detail).toMatch(`id=${CANARY_INVOICE_ID}`);
  });

  it('indexer:stats — stats endpoint is reachable', async () => {
    const results = await checkIndexer();
    const statsCheck = results.find((r) => r.name === 'indexer:stats');
    expect(statsCheck).toBeDefined();
    expect(statsCheck?.passed).toBe(true);
  });

  it('fails gracefully when indexer returns a 404 for the canary invoice', async () => {
    indexerInvoiceNotFound = true;
    const results = await checkIndexer();
    const invoiceCheck = results.find((r) =>
      r.name.startsWith('indexer:invoice:'),
    );
    expect(invoiceCheck?.passed).toBe(false);
    expect(invoiceCheck?.error).toMatch(/not found/i);
    indexerInvoiceNotFound = false;
  });
});

// ── Notifications Checks ──────────────────────────────────────────────────────

describe('Notifications synthetic canary checks', () => {
  it('notifications:health — reports status=ok', async () => {
    notificationsHealthStatus = 'ok';
    const results = await checkNotifications();
    const healthCheck = results.find((r) => r.name === 'notifications:health');
    expect(healthCheck).toBeDefined();
    expect(healthCheck?.passed).toBe(true);
  });

  it('notifications:channel:email — email channel is responsive', async () => {
    const results = await checkNotifications();
    const emailCheck = results.find(
      (r) => r.name === 'notifications:channel:email',
    );
    expect(emailCheck).toBeDefined();
    expect(emailCheck?.passed).toBe(true);
  });

  it('notifications:channel:webhook — webhook channel is reachable', async () => {
    const results = await checkNotifications();
    const webhookCheck = results.find(
      (r) => r.name === 'notifications:channel:webhook',
    );
    expect(webhookCheck).toBeDefined();
    expect(webhookCheck?.passed).toBe(true);
  });

  it('notifications:channel:sms — SMS channel is responsive', async () => {
    const results = await checkNotifications();
    const smsCheck = results.find(
      (r) => r.name === 'notifications:channel:sms',
    );
    expect(smsCheck).toBeDefined();
    expect(smsCheck?.passed).toBe(true);
  });

  it('notifications:channel:websocket — WebSocket heartbeat received', async () => {
    const results = await checkNotifications();
    const wsCheck = results.find(
      (r) => r.name === 'notifications:channel:websocket',
    );
    expect(wsCheck).toBeDefined();
    expect(wsCheck?.passed).toBe(true);
    expect(wsCheck?.detail).toMatch(/heartbeat received/i);
  });

  it('reports failure when notifications service is degraded', async () => {
    notificationsHealthStatus = 'error';
    const results = await checkNotifications();
    const healthCheck = results.find((r) => r.name === 'notifications:health');
    expect(healthCheck?.passed).toBe(false);
    notificationsHealthStatus = 'ok';
  });
});

// ── Oracle Checks ─────────────────────────────────────────────────────────────

describe('Oracle synthetic canary checks', () => {
  it('oracle:health — reports status=ok', async () => {
    oracleHealthStatus = 'ok';
    const results = await checkOracle();
    const healthCheck = results.find((r) => r.name === 'oracle:health');
    expect(healthCheck).toBeDefined();
    expect(healthCheck?.passed).toBe(true);
  });

  it('oracle:verify — correctly assesses the canary address', async () => {
    oracleVerifyStatus = 200;
    oracleCorruptPayload = false;
    const results = await checkOracle();
    const verifyCheck = results.find((r) => r.name.startsWith('oracle:verify:'));
    expect(verifyCheck).toBeDefined();
    expect(verifyCheck?.passed).toBe(true);
    expect(verifyCheck?.detail).toMatch(/trustScore=/);
    expect(verifyCheck?.detail).toMatch(/isVerified=/);
  });

  it('oracle:verify — fails when oracle returns a 500', async () => {
    oracleVerifyStatus = 500;
    const results = await checkOracle();
    const verifyCheck = results.find((r) => r.name.startsWith('oracle:verify:'));
    expect(verifyCheck?.passed).toBe(false);
    expect(verifyCheck?.error).toMatch(/HTTP 500/);
    oracleVerifyStatus = 200;
  });

  it('oracle:verify — fails when payer field is missing from response', async () => {
    oracleCorruptPayload = true;
    const results = await checkOracle();
    const verifyCheck = results.find((r) => r.name.startsWith('oracle:verify:'));
    expect(verifyCheck?.passed).toBe(false);
    oracleCorruptPayload = false;
  });
});

// ── Full Suite Integration ────────────────────────────────────────────────────

describe('runAllCanaryChecks — full suite', () => {
  it('passes when all services return healthy responses', async () => {
    indexerHealthStatus = 'ok';
    indexerInvoiceNotFound = false;
    notificationsHealthStatus = 'ok';
    oracleHealthStatus = 'ok';
    oracleVerifyStatus = 200;
    oracleCorruptPayload = false;

    const report = await runAllCanaryChecks();
    expect(report.passed).toBe(true);
    expect(report.runAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.checks.length).toBeGreaterThanOrEqual(8);
  });

  it('marks overall report as failed when any single check fails', async () => {
    indexerInvoiceNotFound = true;
    const report = await runAllCanaryChecks();
    expect(report.passed).toBe(false);
    const failed = report.checks.filter((c) => !c.passed);
    expect(failed.length).toBeGreaterThan(0);
    indexerInvoiceNotFound = false;
  });
});
