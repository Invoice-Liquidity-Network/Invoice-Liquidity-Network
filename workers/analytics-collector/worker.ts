// Cloudflare Worker — ILN SDK usage analytics collector
// Deploy with: wrangler deploy
// Requires: HYPERDRIVE binding to a Postgres database (configured in wrangler.toml)

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

interface Hyperdrive {
  connectionString: string;
}

// Fields that must never appear in an inbound payload
const BLOCKED_FIELDS = [
  'address',
  'freelancer',
  'payer',
  'funder',
  'secretKey',
  'publicKey',
  'amount',
  'invoiceId',
  'walletAddress',
];

const ALLOWED_METHODS = new Set([
  'submitInvoice',
  'fundInvoice',
  'markPaid',
  'claimDefault',
  'getInvoice',
]);

const ALLOWED_NETWORKS = new Set(['testnet', 'mainnet', 'unknown']);

function isValidPayload(body: unknown): body is {
  method: string;
  success: boolean;
  errorCode?: string;
  network: string;
  version: string;
} {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;

  // Block any PII fields
  if (BLOCKED_FIELDS.some((f) => f in b)) return false;

  if (typeof b['method'] !== 'string') return false;
  if (typeof b['success'] !== 'boolean') return false;
  if (typeof b['network'] !== 'string') return false;
  if (typeof b['version'] !== 'string') return false;
  if ('errorCode' in b && typeof b['errorCode'] !== 'string') return false;

  // Allowlist method and network to prevent garbage data
  if (!ALLOWED_METHODS.has(b['method'] as string)) return false;
  if (!ALLOWED_NETWORKS.has(b['network'] as string)) return false;

  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/event') {
      return new Response('Not Found', { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    if (!isValidPayload(body)) {
      return new Response('Bad Request', { status: 400 });
    }

    // Insert into Postgres via Hyperdrive
    // In production, use a Postgres client compatible with Workers (e.g. postgres.js)
    // The connection string is available via env.HYPERDRIVE.connectionString
    // Example insert (pseudo-code — replace with actual pg client call):
    //
    //   const sql = postgres(env.HYPERDRIVE.connectionString);
    //   await sql`
    //     INSERT INTO sdk_events (method, success, error_code, network, version)
    //     VALUES (${body.method}, ${body.success}, ${body.errorCode ?? null}, ${body.network}, ${body.version})
    //   `;
    //   await sql.end();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
