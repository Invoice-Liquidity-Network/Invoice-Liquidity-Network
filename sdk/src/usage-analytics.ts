const SDK_VERSION = '0.1.0';
const DEFAULT_ENDPOINT = 'https://analytics.iln.finance/event';

// Fields that must never appear in an analytics payload
const PII_FIELDS = [
  'address',
  'freelancer',
  'payer',
  'funder',
  'secretKey',
  'publicKey',
  'amount',
  'invoiceId',
];

export interface UsageEvent {
  method: string;
  success: boolean;
  errorCode?: string;
  network: string;
  version: string;
}

function isEnabled(): boolean {
  if (typeof process === 'undefined') return false;
  return process.env['ILN_ANALYTICS'] === '1';
}

function endpoint(): string {
  if (typeof process !== 'undefined' && process.env['ILN_ANALYTICS_ENDPOINT']) {
    return process.env['ILN_ANALYTICS_ENDPOINT'];
  }
  return DEFAULT_ENDPOINT;
}

function hasPiiFields(payload: Record<string, unknown>): boolean {
  return PII_FIELDS.some((f) => f in payload);
}

export function track(method: string, network: string, success: boolean, errorCode?: string): void {
  if (!isEnabled()) return;

  const payload: UsageEvent = { method, success, network, version: SDK_VERSION };
  if (errorCode) payload.errorCode = errorCode;

  // Safety guard: never send if PII fields were somehow included
  if (hasPiiFields(payload as unknown as Record<string, unknown>)) return;

  const url = endpoint();
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // fire-and-forget: ignore network errors silently
    });
  } catch {
    // fetch itself threw (e.g. not available in env) — ignore
  }
}
