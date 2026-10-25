/**
 * Recipient identity and validation (issues #1278, #1279).
 *
 * A Stellar wallet address identifies *who* a notification is about; it is
 * never a place a notification can be delivered to. Before #1278 the digest
 * path registered `email: target.recipient`, i.e. the wallet address, as the
 * mailbox — every daily/weekly digest went to an undeliverable "address" such
 * as `GABC…`, and the provider error was the only signal.
 *
 * This module keeps the two concepts apart:
 * - `resolveEmailRecipient()` maps a wallet identity to the email destination
 *   the user actually registered (an `email` subscription), and refuses rather
 *   than falling back to the wallet address;
 * - `validateEmailRecipient()` is the gate every email must pass before it is
 *   enqueued for digest delivery (#1279).
 */
import type { NotificationTrigger } from './types';

/** RFC 5321 limits: 64-octet local part, 254-octet path. */
const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
const MAX_DOMAIN_LABEL_LENGTH = 63;

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;
const TLD = /^[A-Za-z]{2,63}$|^xn--[A-Za-z0-9-]{1,59}$/;

/** Stellar account (G…), muxed (M…) and contract (C…) StrKeys. */
const STELLAR_STRKEY = /^[GMC][A-Z2-7]{55}([A-Z2-7]{13})?$/;

export type RecipientRejectionReason =
  | 'missing'
  | 'too_long'
  | 'control_characters'
  | 'wallet_address'
  | 'malformed'
  | 'no_email_subscription';

export type EmailValidationResult =
  | { valid: true; email: string }
  | { valid: false; reason: RecipientRejectionReason };

export function isStellarAddress(value: string): boolean {
  return STELLAR_STRKEY.test(value);
}

/**
 * Strict email gate for anything about to be enqueued for delivery.
 *
 * Stricter than the subscription-time `isValidEmail()` regex on purpose: it
 * rejects CR/LF and other control characters (header injection into the
 * provider request), RFC 5321 length overruns the provider would bounce, and
 * Stellar addresses, which is the exact shape of the #1278 regression.
 */
export function validateEmailRecipient(value: unknown): EmailValidationResult {
  if (typeof value !== 'string' || value.trim() === '') {
    return { valid: false, reason: 'missing' };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(value)) {
    return { valid: false, reason: 'control_characters' };
  }
  if (value.length > MAX_EMAIL_LENGTH) {
    return { valid: false, reason: 'too_long' };
  }
  if (isStellarAddress(value)) {
    return { valid: false, reason: 'wallet_address' };
  }

  const at = value.lastIndexOf('@');
  if (at <= 0 || at !== value.indexOf('@')) {
    return { valid: false, reason: 'malformed' };
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > MAX_LOCAL_PART_LENGTH || !LOCAL_PART.test(local)) {
    return {
      valid: false,
      reason: local.length > MAX_LOCAL_PART_LENGTH ? 'too_long' : 'malformed',
    };
  }

  const labels = domain.split('.');
  if (labels.length < 2) {
    return { valid: false, reason: 'malformed' };
  }
  for (const label of labels) {
    if (label.length > MAX_DOMAIN_LABEL_LENGTH || !DOMAIN_LABEL.test(label)) {
      return { valid: false, reason: 'malformed' };
    }
  }
  if (!TLD.test(labels[labels.length - 1])) {
    return { valid: false, reason: 'malformed' };
  }

  return { valid: true, email: value };
}

export class InvalidRecipientError extends Error {
  readonly retryable = false;

  constructor(readonly reason: RecipientRejectionReason, readonly channel: string) {
    super(`Invalid ${channel} recipient: ${reason}`);
    this.name = 'InvalidRecipientError';
  }
}

/** Minimal subscription shape needed to resolve a notification address. */
export interface RecipientSubscription {
  channel: string;
  destination?: string;
  email?: string;
  triggers?: string[];
}

export type EmailResolution =
  | { ok: true; email: string }
  | { ok: false; reason: RecipientRejectionReason };

/**
 * Resolve the email a wallet identity has registered for `trigger`.
 *
 * Only `email` subscriptions are considered, and only their `destination`.
 * The wallet address is never used as a fallback: when no valid mailbox is
 * registered the caller gets a rejection reason and must skip delivery. The
 * first valid destination wins (subscriptions are ordered by id), so the
 * choice is deterministic across restarts.
 */
export function resolveEmailRecipient(
  walletAddress: string,
  trigger: NotificationTrigger,
  subscriptions: RecipientSubscription[]
): EmailResolution {
  const candidates = subscriptions.filter(
    (subscription) =>
      subscription.channel === 'email' &&
      (subscription.triggers === undefined || subscription.triggers.includes(trigger))
  );
  if (candidates.length === 0) {
    return { ok: false, reason: 'no_email_subscription' };
  }

  let rejection: RecipientRejectionReason | undefined;
  for (const subscription of candidates) {
    const destination = subscription.destination ?? subscription.email;
    const result: EmailValidationResult =
      destination === walletAddress
        ? { valid: false, reason: 'wallet_address' }
        : validateEmailRecipient(destination);
    if (result.valid) {
      return { ok: true, email: result.email };
    }
    rejection ??= result.reason;
  }
  return { ok: false, reason: rejection ?? 'missing' };
}

/**
 * Redact a destination for logs: keep enough to correlate (`ja***@ex***.com`,
 * `GABC…WXYZ`, `https://host/***`) without writing the full contact detail.
 */
export function maskRecipient(value: string | undefined | null): string {
  if (!value) return '<none>';
  if (isStellarAddress(value)) {
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  }
  const at = value.indexOf('@');
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    const dot = domain.lastIndexOf('.');
    const host = dot > 0 ? domain.slice(0, dot) : domain;
    const tld = dot > 0 ? domain.slice(dot) : '';
    return `${local.slice(0, 2)}***@${host.slice(0, 2)}***${tld}`;
  }
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `${url.protocol}//${url.host}/***`;
    }
  } catch {
    // not a URL
  }
  if (/^\+\d{4,}$/.test(value)) {
    return `${value.slice(0, 3)}***${value.slice(-2)}`;
  }
  return `${value.slice(0, 2)}***`;
}
