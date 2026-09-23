import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ILNClient } from '@iln/sdk';
import { ILNContext } from './ILNContext';

export interface ILNProviderProps {
  client: ILNClient;
  children: ReactNode;
  queryClient?: QueryClient;
}

const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export function ILNProvider({
  client,
  children,
  queryClient = defaultQueryClient,
}: ILNProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ILNContext.Provider value={client}>{children}</ILNContext.Provider>
    </QueryClientProvider>
  );
}
