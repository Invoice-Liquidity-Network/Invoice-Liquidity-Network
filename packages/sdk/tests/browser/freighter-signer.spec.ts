import { test, expect } from '@playwright/test';

const MOCK_FREIGHTER_MODULE = `export const isConnected = async () => ({ isConnected: true });
export const getAddress = async () => ({ address: 'GABCDEF1234567890ABCDEF1234567890ABCDEF12' });
export const getNetworkDetails = async () => ({ networkPassphrase: 'Test SDF Network ; September 2015' });
export const requestAccess = async () => ({ address: 'GABCDEF1234567890ABCDEF1234567890ABCDEF12' });
export const signTransaction = async (xdr, opts) => ({ signedTxXdr: 'signed:' + xdr, error: null, signerAddress: 'GABCDEF1234567890ABCDEF1234567890ABCDEF12' });`;

const MOCK_FREIGHTER_WRONG_NETWORK = `export const isConnected = async () => ({ isConnected: true });
export const getAddress = async () => ({ address: 'GABCDEF1234567890ABCDEF1234567890ABCDEF12' });
export const getNetworkDetails = async () => ({ networkPassphrase: 'Public Global Stellar Network ; September 2015' });
export const requestAccess = async () => ({ address: 'GABCDEF1234567890ABCDEF1234567890ABCDEF12' });
export const signTransaction = async (xdr, opts) => ({ signedTxXdr: 'signed:' + xdr, error: null, signerAddress: 'GABCDEF1234567890ABCDEF1234567890ABCDEF12' });`;

const MOCK_FREIGHTER_SIGN_ERROR = `export const isConnected = async () => ({ isConnected: true });
export const getAddress = async () => ({ address: 'GABCDEF1234567890ABCDEF1234567890ABCDEF12' });
export const getNetworkDetails = async () => ({ networkPassphrase: 'Test SDF Network ; September 2015' });
export const requestAccess = async () => ({ address: 'GABCDEF1234567890ABCDEF1234567890ABCDEF12' });
export const signTransaction = async (xdr, opts) => ({ signedTxXdr: null, error: 'User rejected request', signerAddress: null });`;

test.describe('ILN SDK Freighter signer browser interaction', () => {
  test('createFreighterSigner is exported from browser bundle', async ({ page }) => {
    await page.route('**/*freighter-api**', async (route) => {
      await route.fulfill({ contentType: 'application/javascript', body: MOCK_FREIGHTER_MODULE });
    });
    await page.goto('/tests/browser/freighter-signer.html');
    await page.waitForFunction(() => window.__freighterReady === true || window.__freighterError !== null, { timeout: 10_000 });

    const error = await page.evaluate(() => window.__freighterError);
    expect(error).toBeNull();
  });

  test('getPublicKey resolves address from Freighter', async ({ page }) => {
    await page.route('**/*freighter-api**', async (route) => {
      await route.fulfill({ contentType: 'application/javascript', body: MOCK_FREIGHTER_MODULE });
    });
    await page.goto('/tests/browser/freighter-signer.html');
    await page.waitForFunction(() => window.__freighterPublicKey !== null, { timeout: 10_000 });

    const publicKey = await page.evaluate(() => window.__freighterPublicKey);
    expect(publicKey).toBe('GABCDEF1234567890ABCDEF1234567890ABCDEF12');
  });

  test('signTransaction delegates to Freighter and returns signed XDR', async ({ page }) => {
    await page.route('**/*freighter-api**', async (route) => {
      await route.fulfill({ contentType: 'application/javascript', body: MOCK_FREIGHTER_MODULE });
    });
    await page.goto('/tests/browser/freighter-signer.html');
    await page.waitForFunction(() => window.__freighterSignResult !== null, { timeout: 10_000 });

    const signResult = await page.evaluate(() => window.__freighterSignResult);
    expect(signResult).toBe('signed:unsigned-xdr');
  });

  test('throws when Freighter is connected to the wrong network', async ({ page }) => {
    await page.route('**/*freighter-api**', async (route) => {
      await route.fulfill({ contentType: 'application/javascript', body: MOCK_FREIGHTER_WRONG_NETWORK });
    });
    await page.goto('/tests/browser/freighter-signer.html');
    await page.waitForFunction(() => window.__freighterSignError !== null, { timeout: 10_000 });

    const error = await page.evaluate(() => window.__freighterSignError);
    expect(error).toContain('Freighter is connected to a different Stellar network');
  });

  test('propagates Freighter signTransaction errors', async ({ page }) => {
    await page.route('**/*freighter-api**', async (route) => {
      await route.fulfill({ contentType: 'application/javascript', body: MOCK_FREIGHTER_SIGN_ERROR });
    });
    await page.goto('/tests/browser/freighter-signer.html');
    await page.waitForFunction(() => window.__freighterSignError !== null, { timeout: 10_000 });

    const error = await page.evaluate(() => window.__freighterSignError);
    expect(error).toBe('User rejected request');
  });
});
