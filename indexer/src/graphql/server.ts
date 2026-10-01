import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { useServer } from 'graphql-ws/lib/use/ws';
import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { RequestHandler } from 'express';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';
import { CONFIG } from '../config';

/** Normalize an IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1) to a plain IP. */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  if (trimmed === '::1') {
    return '127.0.0.1';
  }
  return trimmed;
}

/**
 * Options that tune the WebSocket subscription surface. They default to the
 * process configuration (SUBSCRIPTION_*) but can be overridden in tests so
 * the limit/auth behaviour can be exercised deterministically.
 */
export interface GraphQLWSOptions {
  /** Optional bearer token required on connections; empty = public. */
  authToken?: string | undefined;
  /** Max concurrent connections (0 = unlimited). */
  maxConnections?: number;
  /** Max concurrent connections per client IP (0 = unlimited). */
  maxConnectionsPerIp?: number;
}

/** Lightweight per-IP connector tracker, scoped to a single server instance. */
class ConnectionLimiter {
  private readonly bySocket = new Map<object, { ip: string }>();
  private readonly perIp = new Map<string, number>();
  private total = 0;

  /**
   * Attempt to accept a connection for `ip`. Returns true when admitted and
   * false when the per-Ip or global cap has been reached.
   */
  admit(socketKey: object, ip: string, maxConnections: number, maxConnectionsPerIp: number): boolean {
    if (maxConnections > 0 && this.total >= maxConnections) {
      return false;
    }
    const count = this.perIp.get(ip) ?? 0;
    if (maxConnectionsPerIp > 0 && count >= maxConnectionsPerIp) {
      return false;
    }
    this.perIp.set(ip, count + 1);
    this.total += 1;
    this.bySocket.set(socketKey, { ip });
    return true;
  }

  release(socketKey: object): void {
    const entry = this.bySocket.get(socketKey);
    if (!entry) {
      return;
    }
    this.bySocket.delete(socketKey);
    this.perIp.set(entry.ip, Math.max(0, (this.perIp.get(entry.ip) ?? 1) - 1));
    this.total = Math.max(0, this.total - 1);
  }
}

export async function createGraphQLServer(
  httpServer: Server,
  wsOptions: GraphQLWSOptions = {}
): Promise<RequestHandler> {
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const authToken = wsOptions.authToken ?? CONFIG.subscriptionAuthToken;
  const maxConnections = wsOptions.maxConnections ?? CONFIG.subscriptionMaxConnections;
  const maxConnectionsPerIp =
    wsOptions.maxConnectionsPerIp ?? CONFIG.subscriptionMaxConnectionsPerIp;

  const wss = new WebSocketServer({ server: httpServer, path: '/graphql' });
  const limiter = new ConnectionLimiter();

  wss.on('connection', (socket, req) => {
    const socketKey: object = socket as unknown as object;
    const ip = normalizeIp(req.socket.remoteAddress ?? 'unknown');

    if (!limiter.admit(socketKey, ip, maxConnections, maxConnectionsPerIp)) {
      // Cap reached - close immediately. The connection is not registered so
      // no explicit release is required.
      socket.close(1008, 'Too many connections');
      return;
    }

    socket.on('close', () => limiter.release(socketKey));
    socket.on('error', () => limiter.release(socketKey));
  });

  useServer(
    {
      schema,
      onConnect: (ctx) => {
        // Optional shared-secret auth: when SUBSCRIPTION_AUTH_TOKEN is set,
        // require the client to present it in the Authorization header during
        // the connection_init handshake.
        if (authToken) {
          const header = ctx.extra.request.headers.authorization ?? '';
          const [scheme, token] = header.split(/\s+/, 2);
          const matches = scheme?.toLowerCase() === 'bearer' && token === authToken;
          if (!matches) {
            throw new Error('Unauthorized');
          }
        }
        console.log(`[graphql-ws] Client connected from ${ctx.extra.request.socket.remoteAddress}`);
      },
      onDisconnect: () => {
        console.log('[graphql-ws] Client disconnected');
      },
      onError: (_ctx, _msg, errors) => {
        console.error('[graphql-ws] Error:', errors);
      },
    },
    wss
  );

  const apolloServer = new ApolloServer({ schema });
  await apolloServer.start();

  return expressMiddleware(apolloServer);
}
