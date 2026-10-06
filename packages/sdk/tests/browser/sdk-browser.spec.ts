import { test, expect } from '@playwright/test';

test.describe('ILN SDK browser bundle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tests/browser/index.html');
    // Wait until the module script has run
    await page.waitForFunction(
      () => (window as any).__ilnReady !== undefined || (window as any).__ilnError !== null
    );
  });

  test('loads without errors', async ({ page }) => {
    const error = await page.evaluate(() => (window as any).__ilnError);
    expect(error).toBeNull();
    const ready = await page.evaluate(() => (window as any).__ilnReady);
    expect(ready).toBe(true);
  });

  test('randomBytes returns correct length via Web Crypto API', async ({ page }) => {
    const len = await page.evaluate(() => (window as any).__ilnRandomBytesLength);
    expect(len).toBe(32);
  });

  test('sha256 returns 32-byte digest', async ({ page }) => {
    const len = await page.evaluate(() => (window as any).__ilnHashLength);
    expect(len).toBe(32);
  });

  test('Web Crypto API is available', async ({ page }) => {
    const available = await page.evaluate(
      () => typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined'
    );
    expect(available).toBe(true);
  });

  test('works inside a sandboxed iframe', async ({ page }) => {
    // The listener lives in the page itself: the iframe can post its message
    // while setContent is still loading, before a test-side listener exists.
    await page.setContent(`
      <script>
        window.addEventListener('message', (e) => { window.__iframeMessage = e.data; }, { once: true });
      </script>
      <iframe
        sandbox="allow-scripts"
        srcdoc="<script>window.parent.postMessage(typeof crypto !== 'undefined' ? 'ok' : 'missing', '*')<\/script>"
      ></iframe>
    `);
    const msg = await page.waitForFunction(() => (window as any).__iframeMessage);
    expect(await msg.jsonValue()).toBe('ok');
  });
});
