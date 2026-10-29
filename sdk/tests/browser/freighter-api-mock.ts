/**
 * Realistic in-page Freighter extension API mock for Playwright browser tests.
 *
 * Mirrors the `@stellar/freighter-api` surface that `createFreighterSigner`
 * dynamically imports in the browser. Playwright drives this mock through
 * `window.__freighterMock` so assertions cover the real SDK signing path,
 * not a bypassed stub of `createFreighterSigner` itself.
 */

export type FreighterMockCall = {
  method: string;
  args: unknown[];
};

export type FreighterMockState = {
  isConnected: boolean;
  /** Address returned by `getAddress` (empty string triggers `requestAccess`). */
  address: string;
  /** Address returned by `requestAccess` when `address` is empty. */
  requestAccessAddress: string;
  networkPassphrase: string;
  networkUrl: string;
  signedTxXdr: string;
  signError: unknown | null;
  connectedError: unknown | null;
  getAddressError: unknown | null;
  requestAccessError: unknown | null;
  networkError: unknown | null;
  /** When true, `getNetworkDetails` is undefined (older Freighter builds). */
  omitNetworkDetails: boolean;
  calls: FreighterMockCall[];
};

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const DEFAULT_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function createInitialState(): FreighterMockState {
  return {
    isConnected: true,
    address: DEFAULT_ADDRESS,
    requestAccessAddress: DEFAULT_ADDRESS,
    networkPassphrase: TESTNET_PASSPHRASE,
    networkUrl: 'https://soroban-testnet.stellar.org',
    signedTxXdr: 'MOCK_SIGNED_TX_XDR',
    signError: null,
    connectedError: null,
    getAddressError: null,
    requestAccessError: null,
    networkError: null,
    omitNetworkDetails: false,
    calls: [],
  };
}

const state: FreighterMockState = createInitialState();

function record(method: string, args: unknown[]): void {
  state.calls.push({ method, args });
}

export async function isConnected(): Promise<{ isConnected?: boolean; error?: unknown }> {
  record('isConnected', []);
  if (state.connectedError) {
    return { error: state.connectedError };
  }
  return { isConnected: state.isConnected };
}

export async function getAddress(): Promise<{ address?: string; error?: unknown }> {
  record('getAddress', []);
  if (state.getAddressError) {
    return { error: state.getAddressError };
  }
  return { address: state.address };
}

export async function requestAccess(): Promise<{ address?: string; error?: unknown }> {
  record('requestAccess', []);
  if (state.requestAccessError) {
    return { error: state.requestAccessError };
  }
  return { address: state.requestAccessAddress || DEFAULT_ADDRESS };
}

async function getNetworkDetailsImpl(): Promise<{
  network?: string;
  networkPassphrase?: string;
  networkUrl?: string;
  error?: unknown;
}> {
  record('getNetworkDetails', []);
  if (state.networkError) {
    return { error: state.networkError };
  }
  return {
    network: 'TESTNET',
    networkPassphrase: state.networkPassphrase,
    networkUrl: state.networkUrl,
  };
}

/** Mutable so older-Freighter mode can set this to `undefined`. */
export let getNetworkDetails: (() => ReturnType<typeof getNetworkDetailsImpl>) | undefined =
  getNetworkDetailsImpl;

export async function signTransaction(
  transactionXdr: string,
  options: { address?: string; networkPassphrase: string }
): Promise<{ signedTxXdr?: string; error?: unknown }> {
  record('signTransaction', [transactionXdr, options]);
  if (state.signError) {
    return { error: state.signError };
  }
  return { signedTxXdr: state.signedTxXdr };
}

export type FreighterMockControl = {
  reset: () => void;
  configure: (partial: Partial<FreighterMockState>) => void;
  getState: () => FreighterMockState;
  getCalls: () => FreighterMockCall[];
};

function syncNetworkDetailsExport(): void {
  getNetworkDetails = state.omitNetworkDetails ? undefined : getNetworkDetailsImpl;
}

const control: FreighterMockControl = {
  reset() {
    Object.assign(state, createInitialState());
    syncNetworkDetailsExport();
  },
  configure(partial) {
    Object.assign(state, partial);
    syncNetworkDetailsExport();
  },
  getState() {
    return { ...state, calls: [...state.calls] };
  },
  getCalls() {
    return [...state.calls];
  },
};

declare global {
  interface Window {
    __freighterMock?: FreighterMockControl;
  }
}

if (typeof window !== 'undefined') {
  window.__freighterMock = control;
}

export default {
  isConnected,
  getAddress,
  requestAccess,
  get getNetworkDetails(): typeof getNetworkDetailsImpl | undefined {
    return getNetworkDetails;
  },
  signTransaction,
};
