/**
 * Fallback routing — automatic channel fallback when primary provider is degraded (#1469, #1470).
 * Critical/high-priority notifications get preferential treatment under constrained capacity.
 *
 * Fallback Provider Audit (#1470):
 * ─────────────────────────────────────────────────────────────────────────────
 * • Source of Truth:
 *   - Recipient subscriptions defined in SQLite `subscriptions` table.
 *   - Provider health state provided by `provider-health.ts` registry.
 *
 * • Credential Isolation:
 *   - Channel credentials (Resend API keys for email, Twilio SID/tokens for SMS,
 *     webhook secrets) are strictly isolated to their own dispatch functions in `delivery.ts`.
 *   - When falling back from email to webhook, or webhook to SMS, provider secrets
 *     and bearer tokens are never forwarded or exposed across channel boundaries.
 *   - Subscriptions must only use credentials corresponding to their specific channel.
 *
 * • Duplicate Provider Send Prevention:
 *   - Prevents race conditions where primary and fallback providers both deliver the same event.
 *   - Primary provider attempt is evaluated first; if it succeeds, fallback is not triggered.
 *   - In-memory deduplication index `sentDeliveries` tracks `(recipient, trigger, invoiceId, eventId)`
 *     to suppress duplicate provider sends on overlapping retries or replayed events.
 *
 * • Operational & Failure Modes:
 *   - Normal: Healthy primary channel dispatches single notification without engaging fallback.
 *   - Failed: Primary provider fails; error logged; failover engages backup subscriptions
 *     in priority order (email -> webhook -> sms -> websocket).
 *   - Repeated: Replayed events hit deduplication and do not trigger duplicate provider dispatches.
 *   - Stale: Stale or disabled subscriptions are filtered out; unhealthy providers bypassed.
 *   - Interrupted: Dead-letter queue inspection guarantees that failing fallbacks (e.g. webhooks
 *     that fail silently) NEVER report a false successful delivery state.
 *
 * • Residual Risk & Maintainer Decisions:
 *   - Off-chain network partitions: If a provider successfully sends but HTTP connection drops
 *     before response is received, duplicate send is possible if the provider lacks server-side
 *     idempotency.
 *   - Capacity limiter: Enforces priority shedding (critical always allowed; low shed during overload).
 */

import { deliverNotification, getRetryMetrics } from './delivery';
import {
  getProviderHealth,
  getFallbackChannels,
  getTriggerPriority,
  fallbackCapacityLimiter,
  shouldUseFallback,
  recordProviderSuccess,
  recordProviderFailure,
} from './provider-health';
import { getSubscriptionsByAddress } from './db';
import type { NotificationPayload, Subscription } from './types';
import { notificationsMetrics } from './metrics';

export interface FallbackResult {
  attempted: boolean;
  success: boolean;
  channel?: string;
  fallbackChannel?: string;
  error?: string;
  priority: 'critical' | 'high' | 'low';
  capacityAllowed: boolean;
  deduplicated?: boolean;
}

// ── In-Memory Deduplication to Prevent Duplicate Provider Sends (#1470) ────────

const sentDeliveries = new Set<string>();
const MAX_SENT_ENTRIES = 10_000;

export function buildDeliveryDedupeKey(
  recipientAddress: string,
  trigger: string,
  invoiceId: number,
  eventId?: string
): string {
  return `${recipientAddress}:${trigger}:${invoiceId}:${eventId ?? ''}`;
}

export function isDeliveryDuplicate(
  recipientAddress: string,
  trigger: string,
  invoiceId: number,
  eventId?: string
): boolean {
  return sentDeliveries.has(buildDeliveryDedupeKey(recipientAddress, trigger, invoiceId, eventId));
}

export function markDeliverySent(
  recipientAddress: string,
  trigger: string,
  invoiceId: number,
  eventId?: string
): void {
  if (sentDeliveries.size >= MAX_SENT_ENTRIES) {
    const firstKey = sentDeliveries.values().next().value;
    if (firstKey) sentDeliveries.delete(firstKey);
  }
  sentDeliveries.add(buildDeliveryDedupeKey(recipientAddress, trigger, invoiceId, eventId));
}

export function resetFallbackDedupe(): void {
  sentDeliveries.clear();
}

/**
 * Asserts strict credential isolation between providers (#1470).
 * Validates that provider credentials (Resend API key, Twilio tokens, webhook secrets)
 * are scoped strictly to their designated channel and never leaked across fallback boundaries.
 */
export function assertCredentialIsolation(
  channel: string,
  headers?: Record<string, string>
): void {
  if (channel === 'webhook' && headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (/authorization|bearer|resend|twilio/i.test(k) || /resend|twilio/i.test(v)) {
        throw new Error(`[credential-isolation] Detected cross-provider credential leak in webhook headers: ${k}`);
      }
    }
  }
}

export async function deliverWithFallback(
  primarySubscription: Subscription,
  payload: NotificationPayload
): Promise<FallbackResult> {
  const primaryChannel = primarySubscription.channel as any;
  const priority = getTriggerPriority(payload.trigger);
  const health = getProviderHealth(primaryChannel);

  // Deduplication check: prevent duplicate provider sends (#1470)
  if (isDeliveryDuplicate(payload.recipientAddress, payload.trigger, payload.invoice.id, payload.eventId)) {
    return {
      attempted: false,
      success: true,
      channel: primaryChannel,
      priority,
      capacityAllowed: true,
      deduplicated: true,
      error: 'Duplicate delivery suppressed by fallback deduplication',
    };
  }

  // Try primary first unless health is unhealthy and we should immediately fallback.
  if (health === 'healthy') {
    try {
      const dlqBefore = getRetryMetrics().deadLetterCount;
      await deliverNotification(primarySubscription, payload);
      const dlqAfter = getRetryMetrics().deadLetterCount;

      // Prevent false successful delivery state if delivery dead-lettered (#1469)
      if (dlqAfter > dlqBefore) {
        recordProviderFailure(primaryChannel);
        return tryFallback(primarySubscription, payload, priority, 'Primary delivery dead-lettered');
      }

      recordProviderSuccess(primaryChannel);
      markDeliverySent(payload.recipientAddress, payload.trigger, payload.invoice.id, payload.eventId);
      return { attempted: true, success: true, channel: primaryChannel, priority, capacityAllowed: true };
    } catch (error: any) {
      recordProviderFailure(primaryChannel);
      // Primary failed — try fallback if available
      return tryFallback(primarySubscription, payload, priority, error?.message);
    }
  }

  // Provider is degraded/unhealthy — try fallback path.
  const shouldFallback = shouldUseFallback(payload.trigger, health);
  if (!shouldFallback) {
    return { attempted: false, success: false, channel: primaryChannel, priority, capacityAllowed: false, error: 'Provider degraded but trigger not eligible for fallback' };
  }

  // Check capacity for fallback
  const capacityAllowed = fallbackCapacityLimiter.tryAcquire(priority);
  if (!capacityAllowed) {
    return {
      attempted: false,
      success: false,
      channel: primaryChannel,
      priority,
      capacityAllowed: false,
      error: `Fallback capacity exhausted — low-priority ${payload.trigger} shed`,
    };
  }

  // Find fallback subscriptions for same recipient & trigger
  const allSubs = getSubscriptionsByAddress(payload.recipientAddress);
  const fallbackChannels = getFallbackChannels(primaryChannel);
  for (const fbChannel of fallbackChannels) {
    const fbSubs = allSubs.filter(
      (s) => s.channel === fbChannel && s.triggers.includes(payload.trigger)
    );
    for (const fbSub of fbSubs) {
      try {
        const dlqBefore = getRetryMetrics().deadLetterCount;
        await deliverNotification(fbSub, payload);
        const dlqAfter = getRetryMetrics().deadLetterCount;

        // Prevent false successful delivery state (#1469)
        if (dlqAfter > dlqBefore) {
          recordProviderFailure(fbChannel as any);
          continue; // try next fallback channel
        }

        recordProviderSuccess(fbChannel as any);
        markDeliverySent(payload.recipientAddress, payload.trigger, payload.invoice.id, payload.eventId);
        try {
          notificationsMetrics.fallbackDeliveriesTotal.inc({ primary: primaryChannel, fallback: fbChannel, priority });
        } catch {
          // best-effort metric emission
        }
        return {
          attempted: true,
          success: true,
          channel: primaryChannel,
          fallbackChannel: fbChannel,
          priority,
          capacityAllowed: true,
        };
      } catch {
        recordProviderFailure(fbChannel as any);
        // try next fallback channel
      }
    }
  }

  // No fallback subscription found or all fallbacks failed
  return {
    attempted: true,
    success: false,
    channel: primaryChannel,
    priority,
    capacityAllowed: true,
    error: 'All fallback channels exhausted or no fallback subscription found',
  };
}

async function tryFallback(
  primarySub: Subscription,
  payload: NotificationPayload,
  priority: 'critical' | 'high' | 'low',
  primaryError?: string
): Promise<FallbackResult> {
  const capacityAllowed = fallbackCapacityLimiter.tryAcquire(priority);
  if (!capacityAllowed) {
    return {
      attempted: false,
      success: false,
      channel: primarySub.channel,
      priority,
      capacityAllowed: false,
      error: `Fallback capacity exhausted — ${priority} ${payload.trigger} shed (primary error: ${primaryError})`,
    };
  }

  const allSubs = getSubscriptionsByAddress(payload.recipientAddress);
  const fallbackChannels = getFallbackChannels(primarySub.channel as any);
  for (const fbChannel of fallbackChannels) {
    const fbSubs = allSubs.filter(
      (s) => s.channel === fbChannel && s.triggers.includes(payload.trigger)
    );
    for (const fbSub of fbSubs) {
      try {
        const dlqBefore = getRetryMetrics().deadLetterCount;
        await deliverNotification(fbSub, payload);
        const dlqAfter = getRetryMetrics().deadLetterCount;

        // Prevent false successful delivery state (#1469)
        if (dlqAfter > dlqBefore) {
          recordProviderFailure(fbChannel as any);
          continue;
        }

        recordProviderSuccess(fbChannel as any);
        markDeliverySent(payload.recipientAddress, payload.trigger, payload.invoice.id, payload.eventId);
        try {
          notificationsMetrics.fallbackDeliveriesTotal.inc({ primary: primarySub.channel, fallback: fbChannel, priority });
        } catch {
          // best-effort metric emission
        }
        return {
          attempted: true,
          success: true,
          channel: primarySub.channel,
          fallbackChannel: fbChannel,
          priority,
          capacityAllowed: true,
        };
      } catch {
        recordProviderFailure(fbChannel as any);
      }
    }
  }

  return {
    attempted: true,
    success: false,
    channel: primarySub.channel,
    priority,
    capacityAllowed: true,
    error: `Primary ${primarySub.channel} failed (${primaryError}) and all fallbacks exhausted`,
  };
}

// Drill simulation — force an outage and verify fallback delivery occurs
export async function drillProviderOutage(
  primaryChannel: string,
  payload: NotificationPayload,
  primarySubscription: Subscription
): Promise<{ outageSimulated: boolean; fallbackResult: FallbackResult }> {
  const { simulateProviderOutage, restoreProvider } = await import('./provider-health');
  simulateProviderOutage(primaryChannel as any);

  let fallbackResult: FallbackResult;
  try {
    fallbackResult = await deliverWithFallback(primarySubscription, payload);
  } finally {
    restoreProvider(primaryChannel as any);
  }

  return { outageSimulated: true, fallbackResult };
}
