import { getPlatformAdapter, type PlatformAdapter } from './platform';

export const STELLAR_URI_SCHEME = 'web+stellar:';

export interface StellarURIParams {
  operation: 'pay' | 'tx' | 'sign';
  destination?: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  memoType?: string;
  xdr?: string;
  callback?: string;
  msg?: string;
  networkPassphrase?: string;
  originDomain?: string;
  signature?: string;
  [key: string]: string | undefined;
}

export interface DeepLinkResult {
  url: string;
  params: StellarURIParams;
}

export function buildStellarURI(params: StellarURIParams): string {
  const base = `${STELLAR_URI_SCHEME}${params.operation}`;
  const queryParams: string[] = [];

  const skipKeys = new Set(['operation']);

  for (const [key, value] of Object.entries(params)) {
    if (skipKeys.has(key) || value === undefined) continue;
    queryParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }

  if (queryParams.length === 0) return base;
  return `${base}?${queryParams.join('&')}`;
}

export function parseStellarURI(uri: string): DeepLinkResult | null {
  if (!uri.startsWith(STELLAR_URI_SCHEME)) return null;

  const withoutScheme = uri.slice(STELLAR_URI_SCHEME.length);
  const qIndex = withoutScheme.indexOf('?');

  let operation: string;
  let queryString: string;

  if (qIndex === -1) {
    operation = withoutScheme;
    queryString = '';
  } else {
    operation = withoutScheme.slice(0, qIndex);
    queryString = withoutScheme.slice(qIndex + 1);
  }

  const params: StellarURIParams = { operation: operation as StellarURIParams['operation'] };

  if (queryString) {
    for (const part of queryString.split('&')) {
      const eqIndex = part.indexOf('=');
      if (eqIndex === -1) continue;
      const key = decodeURIComponent(part.slice(0, eqIndex));
      const value = decodeURIComponent(part.slice(eqIndex + 1));
      params[key] = value;
    }
  }

  return { url: uri, params };
}

export function buildSigningDeepLink(
  transactionXdr: string,
  networkPassphrase: string,
  callbackUrl?: string
): string {
  const params: StellarURIParams = {
    operation: 'sign',
    xdr: transactionXdr,
    networkPassphrase,
  };

  if (callbackUrl) {
    params.callback = callbackUrl;
  }

  return buildStellarURI(params);
}

export function buildPayDeepLink(
  destination: string,
  amount: string,
  options?: {
    assetCode?: string;
    assetIssuer?: string;
    memo?: string;
    memoType?: string;
    callback?: string;
    msg?: string;
    networkPassphrase?: string;
  }
): string {
  const params: StellarURIParams = {
    operation: 'pay',
    destination,
    amount,
    ...options,
  };

  return buildStellarURI(params);
}

export function extractSignedXDRFromCallback(url: string): string | null {
  const parsed = parseStellarURI(url);
  if (parsed?.params.xdr) return parsed.params.xdr;

  try {
    const urlObj = new URL(url);
    const xdr = urlObj.searchParams.get('xdr');
    if (xdr) return xdr;
  } catch {
    // malformed URL — fall through to null
  }

  return null;
}

export function extractTransactionHashFromCallback(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get('tx') ?? null;
  } catch {
    return null;
  }
}

export function waitForDeepLinkCallback(timeoutMs: number = 120_000): Promise<string> {
  const adapter: PlatformAdapter = getPlatformAdapter();

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Deep link callback timed out'));
    }, timeoutMs);

    const cleanup = adapter.addURLListener((url: string) => {
      const parsed = parseStellarURI(url);
      if (parsed && (parsed.params.xdr || parsed.params.tx)) {
        clearTimeout(timeout);
        cleanup();
        resolve(url);
      }
    });

    adapter.getInitialURL().then((initialUrl) => {
      if (initialUrl) {
        const parsed = parseStellarURI(initialUrl);
        if (parsed && (parsed.params.xdr || parsed.params.tx)) {
          clearTimeout(timeout);
          cleanup();
          resolve(initialUrl);
        }
      }
    });
  });
}

export function buildCallbackUrl(scheme: string = 'ilnsdk'): string {
  return `${scheme}://wallet/callback`;
}
