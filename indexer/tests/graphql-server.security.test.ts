import { afterEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import { createGraphQLServer, type GraphQLWSOptions } from '../src/graphql/server';

/**
 * Integration tests for the GraphQL WebSocket transport's resource-exhaustion
 * protections added alongside the pubsub consolidation:
 *   • a global cap on concurrent connections
 *   • a per-IP cap on concurrent connections
 *   • optional shared-secret authentication via the Authorization header
 *
 * Each test spins up a real http + ws server on an ephemeral port so the
 * onConnect/auth and on-connection admission logic in server.ts is exercised
 * end-to-end. Options are injected per server so the caps are deterministic.
 */

const openedServers: http.Server[] = [];

async function startServer(
  options: GraphQLWSOptions = {}
): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(() => {
    /* no REST handling needed */
  });
  await createGraphQLServer(server, options);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  openedServers.push(server);
  return { server, url: `ws://127.0.0.1:${port}/graphql` };
}

function connect(
  url: string,
  headers: Record<string, string> = {}
): { ws: WebSocket; open: Promise<void>; close: Promise<{ code: number; wasClean: boolean }> } {
  const ws = new WebSocket(url, { headers });
  const open = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const close = new Promise<{ code: number; wasClean: boolean }>((resolve) => {
    ws.once('close', (code, reason, wasClean) => resolve({ code, wasClean }));
  });
  return { ws, open, close };
}

/** Send a graphql-transport-ws connection_init handshake frame. */
function sendInit(ws: WebSocket) {
  ws.send(JSON.stringify({ id: '1', type: 'connection_init', payload: {} }));
}

/**
 * Assert that a connection attempt is rejected: the socket is closed without
 * ever completing a usable handshake (or, when `sendHandshake` is set, closes
 * after the connection_init is sent - the auth-rejection path).
 */
async function expectRejected(
  url: string,
  headers: Record<string, string> = {},
  sendHandshake = false
): Promise<{ code: number; wasClean: boolean }> {
  const { ws, open, close } = connect(url, headers);
  // The open promise rejects when the server refuses the connection - swallow
  // it so vitest doesn't report an unhandled rejection.
  open.catch(() => {});
  if (sendHandshake) {
    await open;
    sendInit(ws);
  }
  const closed = await close;
  ws.close();
  return closed;
}

afterEach(async () => {
  await Promise.all(
    openedServers
      .splice(0)
      .reverse()
      .map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
  );
});

describe('GraphQL WebSocket connection limits', () => {
  it('rejects connections beyond the global cap', async () => {
    const { url } = await startServer({ maxConnections: 2, maxConnectionsPerIp: 10 });

    const first = connect(url);
    await first.open;
    const second = connect(url);
    await second.open;

    await expectRejected(url);

    first.ws.close();
    second.ws.close();
  });

  it('rejects connections beyond the per-IP cap', async () => {
    const { url } = await startServer({ maxConnections: 0, maxConnectionsPerIp: 1 });

    const first = connect(url);
    await first.open;

    await expectRejected(url);

    first.ws.close();
  });

  it('releases the per-IP slot once a socket disconnects', async () => {
    const { url } = await startServer({ maxConnections: 0, maxConnectionsPerIp: 1 });

    const first = connect(url);
    await first.open;
    first.ws.close();
    await first.close;

    // After a disconnect the slot should be free again.
    const second = connect(url);
    await second.open;
    second.ws.close();
    await second.close;
  });

  it('allows new connections after the global cap is back below the limit', async () => {
    const { url } = await startServer({ maxConnections: 1, maxConnectionsPerIp: 0 });

    const first = connect(url);
    await first.open;

    await expectRejected(url);

    first.ws.close();
    await first.close;

    const third = connect(url);
    await third.open;
    third.ws.close();
    await third.close;
  });
});

describe('GraphQL WebSocket authentication', () => {
  it('rejects connections when the configured token is absent', async () => {
    const { url } = await startServer({
      authToken: 's3cret-token',
      maxConnections: 0,
      maxConnectionsPerIp: 0,
    });
    await expectRejected(url, {}, true);
  });

  it('rejects connections with a wrong token', async () => {
    const { url } = await startServer({
      authToken: 's3cret-token',
      maxConnections: 0,
      maxConnectionsPerIp: 0,
    });
    await expectRejected(url, { Authorization: 'Bearer wrong-token' }, true);
  });

  it('accepts a connection presenting the correct token', async () => {
    const { url } = await startServer({
      authToken: 's3cret-token',
      maxConnections: 0,
      maxConnectionsPerIp: 0,
    });
    const connection = connect(url, { Authorization: 'Bearer s3cret-token' });
    await connection.open;
    connection.ws.close();
    await connection.close;
  });

  it('keeps subscriptions public when no token is configured', async () => {
    const { url } = await startServer({ maxConnections: 0, maxConnectionsPerIp: 0 });
    const connection = connect(url);
    await connection.open;
    connection.ws.close();
    await connection.close;
  });
});