import { useCallback, useContext, useState } from 'react';
import { ILNContext } from '../context/ILNContext';

export interface UseILNResult {
  isInitialized: boolean;
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
  connect: () => Promise<void>;
}

/**
 * Hook for SDK initialization and wallet connection management.
 *
 * Must be used inside an ILNProvider. Returns wallet state and a connect function.
 *
 * @returns {UseILNResult} Wallet state and connect function
 *
 * @example
 * ```tsx
 * function ConnectButton() {
 *   const { isConnected, isConnecting, address, connect, error } = useILN();
 *
 *   if (isConnected) return <span>Connected: {address}</span>;
 *
 *   return (
 *     <button onClick={connect} disabled={isConnecting}>
 *       {isConnecting ? 'Connecting…' : 'Connect Wallet'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useILN(): UseILNResult {
  const client = useContext(ILNContext);

  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const connect = useCallback(async () => {
    if (!client) {
      setError(new Error('ILN client not initialized. Wrap your app with <ILNProvider>.'));
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const walletAddress = await (
        client as unknown as { connectWallet(): Promise<string> }
      ).connectWallet();
      setAddress(walletAddress);
      setIsConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Wallet connection failed'));
    } finally {
      setIsConnecting(false);
    }
  }, [client]);

  return {
    isInitialized: client !== null,
    address,
    isConnected,
    isConnecting,
    error,
    connect,
  };
}
