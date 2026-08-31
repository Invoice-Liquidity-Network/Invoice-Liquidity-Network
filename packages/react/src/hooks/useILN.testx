import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useILN } from './useILN';
import { createMockILNClient } from '../test/mocks';
import { TestWrapper } from '../test/wrapper';

describe('useILN', () => {
  it('returns isInitialized false when not inside a provider', () => {
    const { result } = renderHook(() => useILN());
    expect(result.current.isInitialized).toBe(false);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBeNull();
  });

  it('returns isInitialized true when inside a provider', () => {
    const mockClient = createMockILNClient();
    const { result } = renderHook(() => useILN(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });
    expect(result.current.isInitialized).toBe(true);
  });

  it('sets error when connect is called without a provider', async () => {
    const { result } = renderHook(() => useILN());

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/not initialized/i);
  });

  it('connects successfully and sets address', async () => {
    const walletAddress = 'GDRMKYQMTNZ3XPRF7K7L3PFBJQI2S2Y2E3KJQF3KHKY3XT3LZXG3G5X2';
    const mockClient = createMockILNClient({
      connectWallet: vi.fn().mockResolvedValue(walletAddress),
    });

    const { result } = renderHook(() => useILN(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.address).toBe(walletAddress);
    expect(result.current.error).toBeNull();
  });

  it('sets error state when connect throws', async () => {
    const mockClient = createMockILNClient({
      connectWallet: vi.fn().mockRejectedValue(new Error('User rejected connection')),
    });

    const { result } = renderHook(() => useILN(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBeNull();
    expect(result.current.error?.message).toBe('User rejected connection');
  });

  it('tracks isConnecting state during connection', async () => {
    let resolveConnect!: (addr: string) => void;
    const connectPromise = new Promise<string>((res) => { resolveConnect = res; });

    const mockClient = createMockILNClient({
      connectWallet: vi.fn().mockReturnValue(connectPromise),
    });

    const { result } = renderHook(() => useILN(), {
      wrapper: ({ children }) => <TestWrapper client={mockClient}>{children}</TestWrapper>,
    });

    expect(result.current.isConnecting).toBe(false);

    act(() => { void result.current.connect(); });
    expect(result.current.isConnecting).toBe(true);

    await act(async () => { resolveConnect('G_ADDRESS'); });
    expect(result.current.isConnecting).toBe(false);
  });
});
