import dotenv from 'dotenv';

dotenv.config();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseIntEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${name}: ${value}`);
  }
  return parsed;
}

export const ALLOWED_CHANNELS = ['email', 'webhook'] as const;
export const ALLOWED_TRIGGERS = [
  'invoice_funded',
  'invoice_paid',
  'invoice_defaulted',
  'invoice_due_soon',
  'invoice_overdue',
] as const;

export const CONFIG = {
  port: parseIntEnv('PORT', 4001),
  dbPath: process.env.NOTIFICATIONS_DB_PATH || 'notifications.sqlite',
  rpcUrl: requiredEnv('NOTIFICATIONS_RPC_URL'),
  contractId: requiredEnv('NOTIFICATIONS_CONTRACT_ID'),
  networkPassphrase: requiredEnv('NOTIFICATIONS_NETWORK_PASSPHRASE'),
  startLedger: parseIntEnv('NOTIFICATIONS_START_LEDGER', 0),
  pollIntervalMs: parseIntEnv('NOTIFICATIONS_POLL_INTERVAL_MS', 30000),
  resendApiKey: requiredEnv('RESEND_API_KEY'),
  resendFromEmail: process.env.RESEND_FROM_EMAIL || 'no-reply@invoice-liquidity.network',
  dueWarningHours: parseIntEnv('DUE_WARNING_HOURS', 48),
  maxWebhookRetry: 3,
  webhookBackoffBaseMs: 500,
};

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateChannel(channel: string): channel is 'email' | 'webhook' {
  return ALLOWED_CHANNELS.includes(channel as any);
}

export function validateTrigger(trigger: unknown): trigger is (typeof ALLOWED_TRIGGERS)[number] {
  return typeof trigger === 'string' && ALLOWED_TRIGGERS.includes(trigger as any);
}
