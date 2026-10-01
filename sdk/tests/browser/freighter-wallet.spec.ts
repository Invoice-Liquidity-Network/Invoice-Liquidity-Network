import { expect, test } from '@playwright/test';

/**
 * Browser E2E coverage for genuine Freighter-shaped wallet interaction.
 *
 * Loads the real `createFreighterSigner` in Chromium against a realistic
 * `@stellar/freighter-api` mock. Unit tests mock Freighter under Vitest; this
 * suite catches browser-path regressions (option forwarding, network checks,
 * requestAccess fallback) before they reach the frontend wallet UX.
 */
test.describe('Freighter wallet-extension interaction (SDK browser path)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(
      () => window.__ilnWalletReady === true || window.__ilnWalletError !== null
    );
    const error = await page.evaluate(() => window.__ilnWalletError);
    expect(error).toBeNull();
    await page.evaluate(() => window.__ilnWallet?.resetMock());
  });

  test('harness loads createFreighterSigner in the browser', async ({ page }) => {
    const ready = await page.evaluate(() => window.__ilnWallet?.ready === true);
    expect(ready).toBe(true);
  });

  test('resolves public key via getAddress when Freighter already has an account', async ({
    page,
  }) => {
    const address = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCVKM';
    await page.evaluate((addr) => {
      window.__ilnWallet?.configureMock({ address: addr });
    }, address);

    const publicKey = await page.evaluate(async () => window.__ilnWallet!.getPublicKey());
    expect(publicKey).toBe(address);

    const methods = await page.evaluate(() =>
      window.__ilnWallet!.getMockCalls().map((c) => c.method)
    );
    expect(methods).toContain('isConnected');
    expect(methods).toContain('getAddress');
    expect(methods).not.toContain('requestAccess');
  });

  test('falls back to requestAccess when getAddress returns empty', async ({ page }) => {
    const address = 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDVKM';
    await page.evaluate((addr) => {
      window.__ilnWallet?.configureMock({
        address: '',
        requestAccessAddress: addr,
      });
    }, address);

    const publicKey = await page.evaluate(async () => window.__ilnWallet!.getPublicKey());
    expect(publicKey).toBe(address);

    const methods = await page.evaluate(() =>
      window.__ilnWallet!.getMockCalls().map((c) => c.method)
    );
    expect(methods).toContain('requestAccess');
  });

  test('signTransaction forwards XDR, address, and networkPassphrase to Freighter', async ({
    page,
  }) => {
    const address = 'GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEWHF';
    await page.evaluate((addr) => {
      window.__ilnWallet?.configureMock({
        address: addr,
        signedTxXdr: 'BROWSER_SIGNED_XDR',
      });
    }, address);

    const result = await page.evaluate(async () => {
      const passphrase = window.__ilnWallet!.Networks.TESTNET;
      return window.__ilnWallet!.signTransaction('UNSIGNED_XDR_PAYLOAD', {
        networkPassphrase: passphrase,
      });
    });

    expect(result).toBe('BROWSER_SIGNED_XDR');

    const signCall = await page.evaluate(() => {
      const calls = window.__ilnWallet!.getMockCalls();
      return calls.find((c) => c.method === 'signTransaction');
    });

    expect(signCall).toBeTruthy();
    expect(signCall!.args[0]).toBe('UNSIGNED_XDR_PAYLOAD');
    expect(signCall!.args[1]).toEqual({
      address,
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  test('rejects when Freighter is on a different network than requested', async ({ page }) => {
    await page.evaluate(() => {
      window.__ilnWallet?.configureMock({
        address: 'GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFWHF',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      });
    });

    const message = await page.evaluate(async () => {
      try {
        await window.__ilnWallet!.signTransaction('UNSIGNED_XDR', {
          networkPassphrase: window.__ilnWallet!.Networks.TESTNET,
        });
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    });

    expect(message).toContain('different Stellar network');
  });

  test('throws when Freighter extension is not connected', async ({ page }) => {
    await page.evaluate(() => {
      window.__ilnWallet?.configureMock({ isConnected: false });
    });

    const message = await page.evaluate(async () => {
      try {
        await window.__ilnWallet!.getPublicKey();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    });

    expect(message).toContain('not installed or not available');
  });

  test('surfaces Freighter sign errors to the caller', async ({ page }) => {
    await page.evaluate(() => {
      window.__ilnWallet?.configureMock({
        address: 'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGWHF',
        signError: 'user rejected',
      });
    });

    const message = await page.evaluate(async () => {
      try {
        await window.__ilnWallet!.signTransaction('UNSIGNED_XDR', {
          networkPassphrase: window.__ilnWallet!.Networks.TESTNET,
        });
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    });

    expect(message).toContain('user rejected');
  });

  test('allows signing when getNetworkDetails is absent (older Freighter)', async ({ page }) => {
    await page.evaluate(() => {
      window.__ilnWallet?.configureMock({
        address: 'GHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHWHF',
        omitNetworkDetails: true,
        signedTxXdr: 'LEGACY_SIGNED_XDR',
      });
    });

    const result = await page.evaluate(async () =>
      window.__ilnWallet!.signTransaction('UNSIGNED_XDR', {
        networkPassphrase: window.__ilnWallet!.Networks.TESTNET,
      })
    );

    expect(result).toBe('LEGACY_SIGNED_XDR');
  });
});
