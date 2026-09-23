import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';
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
 * entirely, so internal services and monitoring are never throttled.
 */
export function createApiRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: CONFIG.rateLimitWindowMs,
    limit: CONFIG.rateLimitMax,
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    skip: (req: Request) => {
      const ip = req.ip ?? '';
      // Normalize ::ffff:x.x.x.x (IPv4-mapped IPv6) and ::1 to their IPv4 equivalents
      const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip === '::1' ? '127.0.0.1' : ip;
      return (
        CONFIG.rateLimitWhitelist.includes(ip) || CONFIG.rateLimitWhitelist.includes(normalized)
      );
    },
    message: {
      error: 'Too many requests - please slow down and try again shortly.',
    },
  });
}
