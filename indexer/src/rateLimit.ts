import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';
import { isIP } from 'node:net';
import { CONFIG } from './config';

/**
 * Builds a per-IP rate limiter for the public indexer API.
 *
 * This is a factory (rather than a module-level singleton) so each
 * `createApp()` call gets its own independent counter store - matching
 * `createApp`'s own "fresh app per call" design and keeping tests that
 * create multiple apps from leaking rate-limit state into each other.
 *
 * Defaults to 100 requests/minute per IP (configurable via
 * RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX). Blocked requests get a 429 with
 * a Retry-After header; every response carries RateLimit-Limit,
 * RateLimit-Remaining, and RateLimit-Reset headers.
 *
 * IPs listed in RATE_LIMIT_WHITELIST (comma-separated) bypass the limiter
 * entirely, so internal services and monitoring are never throttled. This is
 * intentionally an exact, parsed IP match: forwarded headers are interpreted
 * by Express according to its trusted-proxy configuration and arbitrary
 * request headers cannot manufacture a whitelist identity.
 */
export function createApiRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: CONFIG.rateLimitWindowMs,
    limit: CONFIG.rateLimitMax,
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    skip: (req: Request) => {
      const normalized = normalizeIp(req.ip ?? '');
      return isIP(normalized) !== 0 && CONFIG.rateLimitWhitelist.includes(normalized);
    },
    message: {
      error: 'Too many requests - please slow down and try again shortly.',
    },
  });
}

/** Normalize only valid IP spellings; never treat arbitrary identifiers as addresses. */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed === '::1' ? '127.0.0.1' : trimmed;
}
