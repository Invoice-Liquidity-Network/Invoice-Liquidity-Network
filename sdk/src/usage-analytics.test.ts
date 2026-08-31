import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { track } from './usage-analytics';

describe('usage-analytics', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['ILN_ANALYTICS'];
    delete process.env['ILN_ANALYTICS_ENDPOINT'];
  });

  it('does not call fetch when ILN_ANALYTICS is not set', () => {
    track('getInvoice', 'testnet', true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call fetch when ILN_ANALYTICS=0', () => {
    process.env['ILN_ANALYTICS'] = '0';
    track('getInvoice', 'testnet', true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls fetch when ILN_ANALYTICS=1', () => {
    process.env['ILN_ANALYTICS'] = '1';
    track('getInvoice', 'testnet', true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends correct method and network', () => {
    process.env['ILN_ANALYTICS'] = '1';
    track('submitInvoice', 'mainnet', true);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.method).toBe('submitInvoice');
    expect(body.network).toBe('mainnet');
    expect(body.success).toBe(true);
    expect(body.version).toBeTruthy();
  });

  it('includes errorCode on failure', () => {
    process.env['ILN_ANALYTICS'] = '1';
    track('fundInvoice', 'testnet', false, 'NetworkError');

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe('NetworkError');
  });

  it('never includes PII fields in the payload', () => {
    process.env['ILN_ANALYTICS'] = '1';
    track('getInvoice', 'testnet', true);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    const piiFields = [
      'address',
      'freelancer',
      'payer',
      'funder',
      'secretKey',
      'publicKey',
      'amount',
      'invoiceId',
    ];
    for (const field of piiFields) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('uses custom endpoint when ILN_ANALYTICS_ENDPOINT is set', () => {
    process.env['ILN_ANALYTICS'] = '1';
    process.env['ILN_ANALYTICS_ENDPOINT'] = 'https://custom.example.com/event';
    track('markPaid', 'testnet', true);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://custom.example.com/event');
  });

  it('does not throw when fetch rejects', async () => {
    process.env['ILN_ANALYTICS'] = '1';
    fetchMock.mockRejectedValueOnce(new Error('network failure'));
    expect(() => track('getInvoice', 'testnet', true)).not.toThrow();
  });
});
