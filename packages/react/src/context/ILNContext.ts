import { createContext, useContext } from 'react';
import type { ILNClient } from '@invoice-liquidity/sdk';

/**
 * Context for sharing the ILNClient instance across the React tree.
 * @internal
 */
export const ILNContext = createContext<ILNClient | null>(null);

/**
 * Error thrown when a hook is used outside of an ILNProvider.
 */
export class ILNProviderNotFoundError extends Error {
  constructor() {
    super('useILNClient must be used within an ILNProvider. Wrap your app with <ILNProvider client={client}>');
    this.name = 'ILNProviderNotFoundError';
  }
}

/**
 * Returns the ILNClient instance from the nearest ILNProvider.
 * @throws {ILNProviderNotFoundError} If used outside of ILNProvider
 */
export function useILNClient(): ILNClient {
  const client = useContext(ILNContext);
  if (!client) {
    throw new ILNProviderNotFoundError();
  }
  return client;
}