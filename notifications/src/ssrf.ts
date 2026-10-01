import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Server-Side Request Forgery (SSRF) protection for outbound webhook delivery.
 *
 * `sendWebhook` POSTs to a subscriber-supplied URL. Without validation, an
 * attacker can point that URL at internal/private hosts (a metadata endpoint
 * like 169.254.169.254, a loopback service, an internal subnet, ...) and have
 * the notification service make requests it controls — this is SSRF.
 *
 * Two classes of attack are defended against here:
 *
 *  1. IP-literal and hostname targets that resolve to a private/internal or
 *     otherwise unroutable address. DNS resolution is re-checked at delivery
 *     time and the hostname is considered safe only if *every* resolved
 *     address is public.
 *
 *  2. DNS rebinding, where a hostname resolves to a public IP on first check
 *     (so it "passes" validation) but to a private IP by the time the actual
 *     request is made. Re-resolving immediately before the request shrinks
 *     the window and rejects any resolution that touches a private range.
 */

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFError';
  }
}

/** Returns a human-readable description of the blocklist entry, or null. */
function blockedRange(ip: string): string | null {
  if (isIP(ip) === 4) {
    return blockedIPv4Range(ip);
  }
  if (isIP(ip) === 6) {
    return blockedIPv6Range(ip);
  }
  return null;
}

function toIPv4Int(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function inCidr(ipInt: number, network: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (network & mask);
}

function blockedIPv4Range(ip: string): string | null {
  const parsed = toIPv4Int(ip);
  const cidr = (network: string, bits: number) => {
    const base = toIPv4Int(network);
    return inCidr(parsed, base, bits);
  };

  if (cidr('0.0.0.0', 8)) return '0.0.0.0/8 (this network)';
  if (cidr('10.0.0.0', 8)) return '10.0.0.0/8 (private)';
  if (cidr('100.64.0.0', 10)) return '100.64.0.0/10 (CGNAT)';
  if (cidr('127.0.0.0', 8)) return '127.0.0.0/8 (loopback)';
  if (cidr('169.254.0.0', 16)) return '169.254.0.0/16 (link-local)';
  if (cidr('172.16.0.0', 12)) return '172.16.0.0/12 (private)';
  if (cidr('192.0.0.0', 24)) return '192.0.0.0/24 (IETF reserved)';
  if (cidr('192.0.2.0', 24)) return '192.0.2.0/24 (documentation)';
  if (cidr('192.168.0.0', 16)) return '192.168.0.0/16 (private)';
  if (cidr('198.18.0.0', 15)) return '198.18.0.0/15 (benchmarking)';
  if (cidr('198.51.100.0', 24)) return '198.51.100.0/24 (documentation)';
  if (cidr('203.0.113.0', 24)) return '203.0.113.0/24 (documentation)';
  if (cidr('224.0.0.0', 4)) return '224.0.0.0/4 (multicast)';
  if (cidr('240.0.0.0', 4)) return '240.0.0.0/4 (reserved)';
  if (parsed === 0xffffffff) return '255.255.255.255 (broadcast)';
  return null;
}

function blockedIPv6Range(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (lower === '::') return ':: (unspecified)';
  if (lower === '::1') return '::1 (loopback)';
  if (lower.startsWith('::ffff:')) {
    const mapped4 = lower.slice('::ffff:'.length);
    return blockedIPv4Range(mapped4) ?? '::ffff:0:0/96 (IPv4-mapped)';
  }
  if (lower.startsWith('64:ff9b:')) return '64:ff9b::/96 (NAT64)';
  if (lower.startsWith('100::')) return '100::/64 (discard)';
  if (lower.startsWith('2001:db8:')) return '2001:db8::/32 (documentation)';
  if (lower.startsWith('2001::')) return '2001::/32 (Teredo)';
  if (lower.startsWith('2002:')) return '2002::/16 (6to4)';
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    const second = parseInt(lower.slice(1, 2), 16);
    if (!Number.isNaN(second)) return 'fc00::/7 (unique local)';
  }
  const firstHextet = parseInt(lower.split(':')[0], 16);
  if (!Number.isNaN(firstHextet)) {
    if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return 'fe80::/10 (link-local)';
    if (firstHextet >= 0xfec0 && firstHextet <= 0xfeff) return 'fec0::/10 (site-local)';
  }
  if (lower.startsWith('ff')) return 'ff00::/8 (multicast)';
  return null;
}

/** True when `ip` is a public, globally routable address. */
export function isPublicIp(ip: string): boolean {
  return blockedRange(ip) === null;
}

/** True when `url` contains a hostname/port and the scheme is http/https. */
export function hasValidWebhookShape(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.hostname.length > 0
  );
}

/** Resolve `hostname` and reject it if any resolved address is non-public. */
export async function assertHostPublic(hostname: string): Promise<void> {
  if (isIP(hostname) !== 0) {
    const blocked = blockedRange(hostname);
    if (blocked) {
      throw new SSRFError(
        `webhook target resolves to a non-public address: ${hostname} (${blocked})`
      );
    }
    return;
  }

  let addresses: string[];
  try {
    const result = await lookup(hostname, { all: true, verbatim: true });
    addresses = result.map((entry) => entry.address);
  } catch {
    throw new SSRFError(`webhook target failed DNS resolution: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new SSRFError(`webhook target has no resolvable address: ${hostname}`);
  }

  for (const address of addresses) {
    const blocked = blockedRange(address);
    if (blocked !== null) {
      throw new SSRFError(
        `webhook target ${hostname} resolves to a non-public address ` +
          `${address} (${blocked})`
      );
    }
  }
}

/**
 * Validate `url` for outbound delivery. Throws `SSRFError` when the target is
 * not an http(s) URL or resolves to a private/internal address, preventing the
 * notification service from being used as an SSRF pivot.
 */
export async function assertWebhookTargetPublic(url: string): Promise<void> {
  if (!hasValidWebhookShape(url)) {
    throw new SSRFError('webhook target must be an http or https URL');
  }
  await assertHostPublic(new URL(url).hostname);
}
