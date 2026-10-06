/**
 * Minimal client for the Toxiproxy HTTP API (https://github.com/Shopify/toxiproxy).
 * Only the calls the harness needs; no dependencies beyond global fetch.
 */
export type ToxicType =
  | 'latency'
  | 'bandwidth'
  | 'slow_close'
  | 'timeout'
  | 'reset_peer'
  | 'slicer'
  | 'limit_data';

export interface Toxic {
  name: string;
  type: ToxicType;
  stream?: 'upstream' | 'downstream';
  toxicity?: number;
  attributes: Record<string, number>;
}

export interface Proxy {
  name: string;
  listen: string;
  upstream: string;
  enabled: boolean;
  toxics?: Toxic[];
}

export interface Fetcher {
  (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export class ToxiproxyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init)
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`toxiproxy ${method} ${path} failed with ${response.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  version(): Promise<string> {
    return this.fetcher(`${this.baseUrl}/version`).then((r) => r.text());
  }

  listProxies(): Promise<Record<string, Proxy>> {
    return this.request('GET', '/proxies');
  }

  getProxy(name: string): Promise<Proxy> {
    return this.request('GET', `/proxies/${name}`);
  }

  /** Partition: stop forwarding entirely (connections are refused). */
  disable(name: string): Promise<Proxy> {
    return this.request('POST', `/proxies/${name}`, { enabled: false });
  }

  enable(name: string): Promise<Proxy> {
    return this.request('POST', `/proxies/${name}`, { enabled: true });
  }

  addToxic(proxy: string, toxic: Toxic): Promise<Toxic> {
    return this.request('POST', `/proxies/${proxy}/toxics`, {
      name: toxic.name,
      type: toxic.type,
      stream: toxic.stream ?? 'downstream',
      toxicity: toxic.toxicity ?? 1,
      attributes: toxic.attributes,
    });
  }

  removeToxic(proxy: string, toxicName: string): Promise<void> {
    return this.request('DELETE', `/proxies/${proxy}/toxics/${toxicName}`);
  }

  listToxics(proxy: string): Promise<Toxic[]> {
    return this.request('GET', `/proxies/${proxy}/toxics`);
  }

  /** Removes every toxic and re-enables every proxy. Always called by the runner, even on failure. */
  reset(): Promise<void> {
    return this.request('POST', '/reset');
  }
}
