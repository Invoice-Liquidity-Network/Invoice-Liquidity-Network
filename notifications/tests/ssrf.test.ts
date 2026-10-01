/**
 * Unit coverage for `src/ssrf.ts` — the SSRF guards that back webhook delivery.
 *
 * These assert the block-list directly, independent of the delivery layer, so a
 * regression in the RFC1918/reserved address tables is caught even if a future
 * refactor stops exercising them through `sendWebhook`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dnsLookup } = vi.hoisted(() => ({
  dnsLookup: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  lookup: dnsLookup,
}));

import { isPublicIp, assertHostPublic, SSRFError } from '../src/ssrf';

beforeEach(() => {
  dnsLookup.mockReset();
  dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('isPublicIp (IPv4)', () => {
  const assertBlocked = (ip: string) => expect(isPublicIp(ip)).toBe(false);
  const assertPublic = (ip: string) => expect(isPublicIp(ip)).toBe(true);

  it('blocks private, link-local, loopback, and special-use ranges', () => {
    assertBlocked('127.0.0.1');
    assertBlocked('10.0.0.1');
    assertBlocked('172.16.0.1');
    assertBlocked('172.31.255.255');
    assertBlocked('192.168.1.1');
    assertBlocked('169.254.169.254');
    assertBlocked('100.64.0.1');
    assertBlocked('0.0.0.0');
    assertBlocked('192.0.2.1');
    assertBlocked('198.51.100.1');
    assertBlocked('203.0.113.1');
    assertBlocked('224.0.0.1');
    assertBlocked('255.255.255.255');
  });

  it('allows public IPv4 addresses', () => {
    assertPublic('93.184.216.34');
    assertPublic('8.8.8.8');
    assertPublic('1.1.1.1');
    assertPublic('172.32.0.1');
    assertPublic('11.0.0.1');
  });
});

describe('isPublicIp (IPv6)', () => {
  const assertBlocked = (ip: string) => expect(isPublicIp(ip)).toBe(false);
  const assertPublic = (ip: string) => expect(isPublicIp(ip)).toBe(true);

  it('blocks loopback, link-local, ULA, and documentation ranges', () => {
    assertBlocked('::1');
    assertBlocked('::');
    assertBlocked('fe80::1');
    assertBlocked('fc00::1');
    assertBlocked('fd12:3456::1');
    assertBlocked('2001:db8::1');
    assertBlocked('::ffff:127.0.0.1');
    assertBlocked('::ffff:192.168.1.1');
  });

  it('allows globally routable IPv6', () => {
    assertPublic('2606:4700:4700::1111');
    assertPublic('2001:4860:4860::8888');
  });
});

describe('assertHostPublic', () => {
  it('rejects a hostname for which any resolved address is private', async () => {
    dnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ]);
    await expect(assertHostPublic('rebind.example.com')).rejects.toThrow(SSRFError);
  });

  it('accepts a hostname with only public addresses', async () => {
    dnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    await expect(assertHostPublic('safe.example.com')).resolves.toBeUndefined();
  });

  it('rejects a hostname that fails to resolve', async () => {
    dnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertHostPublic('nope.example.com')).rejects.toThrow('DNS resolution');
  });
});
