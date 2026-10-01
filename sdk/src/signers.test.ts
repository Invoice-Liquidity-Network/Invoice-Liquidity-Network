import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, Networks, TransactionBuilder, BASE_FEE, Operation } from '@stellar/stellar-sdk';

vi.mock('@stellar/freighter-api', () => ({
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
}));

import * as freighterApi from '@stellar/freighter-api';

import { createFreighterSigner, createKeypairSigner } from './signers';

describe('createFreighterSigner', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
      networkUrl: 'https://rpc.example.test',
    });
  });

  it('uses Freighter to resolve the account and sign transactions', async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: '' });
    vi.mocked(freighterApi.requestAccess).mockResolvedValue({
      address: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12',
    });
    vi.mocked(freighterApi.signTransaction).mockResolvedValue({
      signerAddress: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12',
      signedTxXdr: 'signed-xdr',
    });

    const signer = createFreighterSigner();
    const address = await signer.getPublicKey();
    const signed = await signer.signTransaction('unsigned-xdr', {
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    expect(address).toBe('GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12');
    expect(signed).toBe('signed-xdr');
    expect(freighterApi.signTransaction).toHaveBeenCalledWith('unsigned-xdr', {
      address: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('throws when Freighter is connected to the wrong network', async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({
      address: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12',
    });
    vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
      network: 'PUBLIC',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
      networkUrl: 'https://rpc.example.public',
    });

    const signer = createFreighterSigner();

    await expect(
      signer.signTransaction('unsigned-xdr', {
        networkPassphrase: 'Test SDF Network ; September 2015',
      })
    ).rejects.toThrow('Freighter is connected to a different Stellar network.');
  });
  it('throws when Freighter is not installed', async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({ isConnected: false });
    const signer = createFreighterSigner();
    await expect(signer.getPublicKey()).rejects.toThrow(
      'Freighter extension is not installed or not available.'
    );
  });

  it('throws when Freighter returns an error on connection check', async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue({
      error: 'Connection error',
      isConnected: false,
    });
    const signer = createFreighterSigner();
    await expect(signer.getPublicKey()).rejects.toThrow('Connection error');
  });

  it('throws when window is undefined', async () => {
    vi.stubGlobal('window', undefined);
    const signer = createFreighterSigner();
    await expect(signer.getPublicKey()).rejects.toThrow(
      'Freighter signing is only available in browser environments.'
    );
  });

  it('throws when getAddress returns an error', async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({
      address: '',
      error: 'Address error',
    });
    const signer = createFreighterSigner();
    await expect(signer.getPublicKey()).rejects.toThrow('Address error');
  });

  it('throws when requestAccess returns an error', async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: '' });
    vi.mocked(freighterApi.requestAccess).mockResolvedValue({
      address: '',
      error: 'Request error',
    });
    const signer = createFreighterSigner();
    await expect(signer.getPublicKey()).rejects.toThrow('Request error');
  });

  it('throws when getNetworkDetails returns an error', async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: 'G123' });
    vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
      error: 'Network error',
      network: '',
      networkPassphrase: '',
      networkUrl: '',
    });
    const signer = createFreighterSigner();
    await expect(
      signer.signTransaction('unsigned-xdr', {
        networkPassphrase: 'Test SDF Network ; September 2015',
      })
    ).rejects.toThrow('Network error');
  });

  it('throws when signTransaction returns an error', async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: 'G123' });
    vi.mocked(freighterApi.signTransaction).mockResolvedValue({
      error: 'Sign error',
      signedTxXdr: '',
      signerAddress: '',
    });
    const signer = createFreighterSigner();
    await expect(
      signer.signTransaction('unsigned-xdr', {
        networkPassphrase: 'Test SDF Network ; September 2015',
      })
    ).rejects.toThrow('Sign error');
  });

  // Trust Model Verification: Freighter signer enforces network passphrase match
  it('trust model: enforces network passphrase match before signing', async () => {
    vi.mocked(freighterApi.getAddress).mockResolvedValue({
      address: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12',
    });
    vi.mocked(freighterApi.getNetworkDetails).mockResolvedValue({
      network: 'PUBLIC',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
      networkUrl: 'https://rpc.example.public',
    });

    const signer = createFreighterSigner();

    // Attempting to sign with a different network passphrase should fail
    await expect(
      signer.signTransaction('unsigned-xdr', {
        networkPassphrase: 'Test SDF Network ; September 2015',
      })
    ).rejects.toThrow('Freighter is connected to a different Stellar network.');

    // Freighter should NOT have been called to sign
    expect(freighterApi.signTransaction).not.toHaveBeenCalled();
  });
});

describe('createKeypairSigner', () => {
  // Trust Model: "The signer holds the correct keypair and protects it from disclosure"
  // The signer should derive the public key from the provided secret key.

  it('trust model: derives correct public key from secret key', async () => {
    const keypair = Keypair.random();
    const signer = createKeypairSigner(keypair.secret());

    const publicKey = await signer.getPublicKey();
    expect(publicKey).toBe(keypair.publicKey());
    expect(publicKey).toMatch(/^G[A-Z0-9]{55}$/);
  });

  it('trust model: signs transaction with the same keypair used for getPublicKey', async () => {
    const keypair = Keypair.random();
    const signer = createKeypairSigner(keypair.secret());

    // Create a minimal valid transaction
    const account = new (await import('@stellar/stellar-sdk')).Account(keypair.publicKey(), '0');
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC',
          function: 'test',
          args: [],
        })
      )
      .setTimeout(30)
      .build();

    const unsignedXdr = tx.toXDR();

    const signedXdr = await signer.signTransaction(unsignedXdr, {
      networkPassphrase: Networks.TESTNET,
    });

    // The signed XDR should be valid and parseable
    const signedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    expect(signedTx).toBeDefined();

    // The signature should be verifiable with the original keypair
    const signedHash = signedTx.hash();
    expect(keypair.verify(signedHash, signedTx.signatures[0].signature())).toBe(true);
  });

  it('trust model: rejects invalid secret key format', () => {
    expect(() => createKeypairSigner('not-a-valid-secret-key')).toThrow();
  });

  it('trust model: rejects empty secret key', () => {
    expect(() => createKeypairSigner('')).toThrow();
  });

  it('trust model: different keypairs produce different public keys', async () => {
    const keypair1 = Keypair.random();
    const keypair2 = Keypair.random();

    const signer1 = createKeypairSigner(keypair1.secret());
    const signer2 = createKeypairSigner(keypair2.secret());

    const pub1 = await signer1.getPublicKey();
    const pub2 = await signer2.getPublicKey();

    expect(pub1).not.toBe(pub2);
  });
});
