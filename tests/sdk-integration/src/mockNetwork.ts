type ResponseLike = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
};

export function withMockFetch(
  handler: (input: RequestInfo, init?: RequestInit) => Promise<ResponseLike> | ResponseLike
) {
  const originalFetch = (globalThis as any).fetch;

  (globalThis as any).fetch = async (input: RequestInfo, init?: RequestInit) => {
    const res = await handler(input, init);
    const body = res.body === undefined ? null : res.body;
    const headers = res.headers ?? { 'content-type': 'application/json' };
    const responseInit: ResponseInit = { status: res.status ?? 200, headers };
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, responseInit);
  };

  return () => {
    (globalThis as any).fetch = originalFetch;
  };
}
