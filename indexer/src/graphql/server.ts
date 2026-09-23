import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { useServer } from 'graphql-ws/lib/use/ws';
import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';

const KEEP_ALIVE_MS = 30_000;

export async function createGraphQLServer(httpServer: Server) {
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const wss = new WebSocketServer({ server: httpServer, path: '/graphql' });

  useServer(
    {
      schema,
      keepAlive: KEEP_ALIVE_MS,
      onConnect: (ctx) => {
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
