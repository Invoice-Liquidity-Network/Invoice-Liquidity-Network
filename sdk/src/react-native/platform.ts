export type PlatformType = 'react-native' | 'browser' | 'node' | 'unknown';

export interface PlatformAdapter {
  platform: PlatformType;
  fetch: typeof globalThis.fetch;
  atob: (input: string) => string;
  btoa: (input: string) => string;
  getEnv: (key: string) => string | undefined;
  getStorage: () => Storage | null;
  openURL: (url: string) => Promise<void>;
  getInitialURL: () => Promise<string | null>;
  addURLListener: (handler: (url: string) => void) => () => void;
}

let cachedPlatform: PlatformType | undefined;

export function detectPlatform(): PlatformType {
  if (cachedPlatform) return cachedPlatform;

  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    cachedPlatform = 'react-native';
  } else if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    cachedPlatform = 'browser';
  } else if (typeof process !== 'undefined' && process.versions?.node) {
    cachedPlatform = 'node';
  } else {
    cachedPlatform = 'unknown';
  }

  return cachedPlatform;
}

function getEnvValue(key: string): string | undefined {
  if (typeof process !== 'undefined' && typeof process.env !== 'undefined') {
    return (process.env as Record<string, string | undefined>)[key];
  }
  return undefined;
}

let storageAdapter: Storage | null | undefined;

function resolveStorage(): Storage | null {
  if (storageAdapter !== undefined) return storageAdapter;

  try {
    if (typeof localStorage !== 'undefined') {
      storageAdapter = localStorage;
      return storageAdapter;
    }
  } catch {
    // localStorage unavailable — fall through to null
  }

  storageAdapter = null;
  return null;
}

function rnOpenURL(url: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- optional peer dep, resolved dynamically
    const Linking = require('react-native').Linking;
    return Linking.openURL(url);
  } catch {
    return Promise.reject(new Error('Linking.openURL is not available'));
  }
}

function rnGetInitialURL(): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- optional peer dep, resolved dynamically
    const Linking = require('react-native').Linking;
    return Linking.getInitialURL();
  } catch {
    return Promise.resolve(null);
  }
}

function rnAddURLListener(handler: (url: string) => void): () => void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- optional peer dep, resolved dynamically
    const Linking = require('react-native').Linking;
    const subscription = Linking.addEventListener('url', (event: { url: string }) => {
      handler(event.url);
    });
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

function globalFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return globalThis.fetch(input, init);
  }
  return Promise.reject(new Error('fetch is not available'));
}

export function getPlatformAdapter(): PlatformAdapter {
  const platform = detectPlatform();

  const base: PlatformAdapter = {
    platform,
    fetch: globalFetch,
    atob:
      typeof globalThis.atob === 'function'
        ? globalThis.atob.bind(globalThis)
        : (input: string) => {
            return Buffer.from(input, 'base64').toString('binary');
          },
    btoa:
      typeof globalThis.btoa === 'function'
        ? globalThis.btoa.bind(globalThis)
        : (input: string) => {
            return Buffer.from(input, 'binary').toString('base64');
          },
    getEnv: getEnvValue,
    getStorage: resolveStorage,
    openURL: async (_url: string) => {
      throw new Error('openURL is not available on this platform');
    },
    getInitialURL: async () => null,
    addURLListener: () => () => {},
  };

  if (platform === 'react-native') {
    return {
      ...base,
      openURL: rnOpenURL,
      getInitialURL: rnGetInitialURL,
      addURLListener: rnAddURLListener,
    };
  }

  if (platform === 'browser') {
    return {
      ...base,
      openURL: async (url: string) => {
        window.location.href = url;
      },
      getInitialURL: async () => {
        return window.location.href;
      },
      addURLListener: (handler: (url: string) => void) => {
        const onHashChange = () => handler(window.location.href);
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
      },
    };
  }

  return base;
}
