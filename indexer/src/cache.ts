import Redis from 'ioredis';
import { CONFIG } from './config';

const INVOICE_TTL_SECONDS = 30;

let _client: Redis | null = null;

function getClient(): Redis | null {
  if (!CONFIG.redisUrl) return null;
  if (!_client) {
    _client = new Redis(CONFIG.redisUrl);
    _client.on('error', (err: Error) => {
      console.error('[cache] Redis error:', err.message);
    });
  }
  return _client;
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    return (await getClient()?.get(key)) ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds = INVOICE_TTL_SECONDS
): Promise<void> {
  try {
    await getClient()?.set(key, value, 'EX', ttlSeconds);
  } catch {
    // Non-fatal: the next request will simply miss the cache.
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    await getClient()?.del(key);
  } catch {
    // Non-fatal.
  }
}

export async function cacheDeletePattern(pattern: string): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(keys);
    }
  } catch {
    // Non-fatal.
  }
}

/** Invalidate all cache entries for a given invoice and every invoice list. */
export async function invalidateInvoiceCache(id: number): Promise<void> {
  await Promise.all([cacheDelete(`invoice:${id}`), cacheDeletePattern('invoices:*')]);
}
