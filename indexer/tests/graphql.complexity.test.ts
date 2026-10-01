import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolverSpy = vi.hoisted(() => vi.fn());
vi.mock('../src/db', async () => {
  const actual = await vi.importActual<typeof import('../src/db')>('../src/db');
  return { ...actual, getProtocolStats: resolverSpy };
});

import { createGraphQLHandler } from '../src/graphql';

beforeEach(() => resolverSpy.mockReset());

describe('GraphQL query limits', () => {
  it('rejects an excessively deep query before execution', async () => {
    const yoga = createGraphQLHandler();
    const query = `query { invoices { edges { node { cursor } pageInfo { endCursor } } } }`;
    // Explicitly exercise the depth guard with a nested field path.
    const deepQuery = `query { invoices { edges { node { id } } } }`;
    // This is intentionally above the configured depth threshold.
    const response = await yoga(new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: deepQuery }),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].message).toMatch(/too deep|too complex/i);
    expect(resolverSpy).not.toHaveBeenCalled();
  });

  it('rejects a high-complexity query before execution', async () => {
    const yoga = createGraphQLHandler();
    const fields = Array.from({ length: 60 }, (_, i) => `f${i}: stats { totalInvoices }`).join('\n');
    const response = await yoga(new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `query { ${fields} }` }),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].message).toContain('too complex');
    expect(resolverSpy).not.toHaveBeenCalled();
  });
});
