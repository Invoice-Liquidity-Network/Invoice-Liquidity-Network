/**
 * Transport-level fault injection for the upstream-outage chaos suite (#1058).
 *
 * Test scaffolding: excluded from coverage in `vitest.config.ts` alongside
 * `testFixtures.ts`, because counting it would inflate the figure the 95% gate
 * exists to protect.
 *
 * ── Why a real socket ────────────────────────────────────────────────────────
 *
 * Every other resilience test in this package injects a *provider function*
 * that throws. That exercises `Promise.allSettled`, but it skips the code that
 * actually has to survive an outage: the `fetch` call, its abort timeout, the
 * response-shape normalisation, and the Soroban RPC client. A mocked provider
 * cannot fail at the transport layer, so a mock cannot prove the service copes
 * when one does.
 *
 * This is a real HTTP listener on a real port. Faults arrive as an actual
 * ECONNREFUSED (the listener is closed), an aborted signal (the listener accepts
 * but never answers), a real 5xx status, a reset connection, and a body that is
 * not what the indexer's route contract promises.
 *
 * ── Which feed it stands in for ──────────────────────────────────────────────
 *
 * The handler mirrors `indexer/src/api.ts` `GET /v1/history/:address`: a bare
 * JSON array, and a 400 for a `role` outside `freelancer|payer|funder`. That
 * last part matters — it means the harness rejects a request the oracle builds
 * wrongly, so the tests assert the real wire contract rather than a shape this
 * file invented.
 *
 * The same object can stand in for a Soroban RPC endpoint, because the fault
 * modes used against it (`error-500`, `stop()`) do not depend on the path. The
 * captured-call log then proves the SDK really reached the network: an outage
 * that never touched a socket would be a configuration mistake, not a test.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { URL } from 'node:url';

import type { IndexerInvoiceHistoryEntry } from './types';

/**
 * - `healthy`      — serve the configured history
 * - `error-500`    — the upstream is up and the request failed
 * - `error-503`    — the upstream is deliberately not serving
 * - `timeout`      — accept the connection and never answer; only the client's
 *                    own deadline can end this request
 * - `reset`        — drop the connection mid-request
 * - `garbage`      — 200 with a JSON body that is not an array
 * - `invalid-json` — 200 with a body that is not JSON at all (a proxy page,
 *                    a captive portal, a truncated write)
 */
export type UpstreamFault =
  | 'healthy'
  | 'error-500'
  | 'error-503'
  | 'timeout'
  | 'reset'
  | 'garbage'
  | 'invalid-json';

export interface CapturedCall {
  readonly method: string;
  readonly path: string;
  readonly query: string;
}

export interface ChaosUpstream {
  readonly baseUrl: string;
  /** Requests the upstream received, oldest first. Cleared by {@link resetCalls}. */
  readonly calls: readonly CapturedCall[];
  setFault(fault: UpstreamFault): void;
  setHistory(entries: IndexerInvoiceHistoryEntry[]): void;
  resetCalls(): void;
  /**
   * Stop listening. Connections to {@link baseUrl} are then refused by the
   * operating system, which is the only way to produce a genuine ECONNREFUSED.
   * Idempotent, and safe to call from teardown.
   */
  stop(): Promise<void>;
}

const HISTORY_ROUTE = /^\/v1\/history\/([^/]+)$/;

function statusFor(fault: UpstreamFault): number | null {
  if (fault === 'error-500') return 500;
  if (fault === 'error-503') return 503;
  return null;
}

export async function startChaosUpstream(
  initialHistory: IndexerInvoiceHistoryEntry[] = []
): Promise<ChaosUpstream> {
  const calls: CapturedCall[] = [];
  const openSockets = new Set<{ destroy(): void }>();
  let fault: UpstreamFault = 'healthy';
  let history = initialHistory;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://upstream.invalid');
    calls.push({ method: req.method ?? 'GET', path: url.pathname, query: url.search });

    if (fault === 'timeout') {
      // Deliberately no response: the client deadline is the only exit.
      return;
    }

    if (fault === 'reset') {
      res.socket?.destroy();
      return;
    }

    const send = (status: number, body: unknown): void => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(payload);
    };

    const upstreamStatus = statusFor(fault);
    if (upstreamStatus !== null) {
      send(upstreamStatus, { error: 'upstream unavailable' });
      return;
    }

    if (fault === 'garbage') {
      send(200, { invoices: history, hasMore: false });
      return;
    }

    if (fault === 'invalid-json') {
      send(200, '<!doctype html><html>upstream is a badge-pressing proxy</html>');
      return;
    }

    const route = HISTORY_ROUTE.exec(url.pathname);
    if (!route) {
      send(404, { error: 'not found' });
      return;
    }

    // Mirrors the indexer's own validation, so a wrongly built request URL from
    // oracle-service fails here instead of silently matching a stub.
    const role = url.searchParams.get('role');
    if (role !== 'freelancer' && role !== 'payer' && role !== 'funder') {
      send(400, { error: 'Invalid role - expected freelancer, payer, or funder' });
      return;
    }

    send(200, history);
  });

  server.on('connection', (socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  let stopped = false;

  return {
    baseUrl,
    calls,
    setFault(next) {
      fault = next;
    },
    setHistory(entries) {
      history = entries;
    },
    resetCalls() {
      calls.length = 0;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((resolve) => {
        // Held requests (the `timeout` fault) would keep `close()` pending
        // forever, so the sockets go first.
        for (const socket of openSockets) {
          socket.destroy();
        }
        openSockets.clear();
        server.close(() => resolve());
      });
    },
  };
}
