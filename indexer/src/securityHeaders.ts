import type { Express, NextFunction, Request, Response } from 'express';

/**
 * HTTP security headers for an ILN API service (issue #1287).
 *
 * docs/threat-model.md lists "refuse to be framed by untrusted origins" and
 * hardened responses as current mitigations for the API layer. Until this
 * module, no ILN service sent a single security header and every response
 * advertised `X-Powered-By: Express`. This makes the threat model's API-layer
 * claims true and keeps them true: scripts/check-security-docs.mjs fails CI if
 * a service stops registering it or its copy drifts from the canonical one.
 *
 * The policy is deliberately one these JSON APIs can always satisfy, so it
 * never needs an exception: it restricts framing, MIME sniffing, referrers,
 * plugins and form targets, and does not restrict scripts — the indexer's
 * Swagger UI (`/docs`) and GraphiQL (`/graphql`) keep working unchanged.
 *
 * Identical copies live in indexer/ and oracle-service/, each a separately
 * deployed package; the docs check enforces that they stay byte-for-byte
 * identical. (notifications/ adopts the same file once it builds again — see
 * docs/security-guide.md.) Register it FIRST, before rate limiting and
 * routing, so 404s, 429s and error responses carry the headers too.
 */

/** Sent on every response. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  // Clickjacking: never render inside a frame (legacy + CSP forms).
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  // Stop browsers reinterpreting JSON as HTML or script.
  'X-Content-Type-Options': 'nosniff',
  // Request URLs carry wallet addresses and ids; do not leak them onward.
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-site',
});

/** Sent only on HTTPS responses: HSTS over plain HTTP is ignored and misleading. */
export const HSTS_HEADER = 'max-age=31536000; includeSubDomains';

export function securityHeaders() {
  return function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', HSTS_HEADER);
    }
    next();
  };
}

/**
 * Apply the policy to an app: drop the framework fingerprint and register the
 * middleware. Call before any other `app.use`.
 */
export function applySecurityHeaders(app: Express): void {
  app.disable('x-powered-by');
  app.use(securityHeaders());
}
