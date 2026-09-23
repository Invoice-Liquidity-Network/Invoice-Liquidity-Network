/**
 * User notification preferences.
 *
 * Covers:
 *   - Channel preferences  (email / SMS / webhook per user)
 *   - Frequency            (realtime / daily / weekly digest)
 *   - Quiet hours          (suppress delivery during a time window)
 *   - Per-trigger overrides (enable/disable individual event types)
 */

import type { NotificationTrigger, SubscriptionChannel } from './types';

// ── Types ──────────────────────────────────────────────────────────────────

export type NotificationFrequency = 'realtime' | 'daily' | 'weekly';

export interface QuietHours {
  /** 0–23 — inclusive start of the quiet window */
  startHour: number;
  /** 0–23 — exclusive end of the quiet window */
  endHour: number;
  /** IANA time zone identifier, e.g. "America/New_York" */
  timezone: string;
}

export interface TriggerPreference {
  trigger: NotificationTrigger;
  /** When false, this trigger is silenced regardless of channel settings */
  enabled: boolean;
  /** Which channels to use for this specific trigger */
  channels: SubscriptionChannel[];
}

export interface UserPreferences {
  stellarAddress: string;
  /** Globally enabled delivery channels */
  enabledChannels: SubscriptionChannel[];
  /** Delivery frequency; "realtime" sends immediately */
  frequency: NotificationFrequency;
  /** Suppress notifications during this window; null means always deliver */
  quietHours: QuietHours | null;
  /** Per-trigger overrides; triggers absent here inherit the global defaults */
  triggerPreferences: TriggerPreference[];
  updatedAt: string;
}

// ── In-memory store ────────────────────────────────────────────────────────

const store = new Map<string, UserPreferences>();

function defaultPreferences(stellarAddress: string): UserPreferences {
  return {
    stellarAddress,
    enabledChannels: ['email', 'webhook'],
    frequency: 'realtime',
    quietHours: null,
    triggerPreferences: [],
    updatedAt: new Date().toISOString(),
  };
}

// ── Service ────────────────────────────────────────────────────────────────

export class PreferencesService {
  /** Return preferences for an address, falling back to defaults. */
  get(stellarAddress: string): UserPreferences {
    return store.get(stellarAddress) ?? defaultPreferences(stellarAddress);
  }

  /** Create or update preferences for an address. */
  upsert(
    stellarAddress: string,
    patch: Partial<Omit<UserPreferences, 'stellarAddress' | 'updatedAt'>>
  ): UserPreferences {
    const current = this.get(stellarAddress);
    const updated: UserPreferences = {
      ...current,
      ...patch,
      stellarAddress,
      updatedAt: new Date().toISOString(),
    };
    store.set(stellarAddress, updated);
    return updated;
  }

  /** Reset an address back to defaults. */
  delete(stellarAddress: string): boolean {
    return store.delete(stellarAddress);
  }

  /**
   * Returns true if the current wall-clock time falls inside the user's
   * quiet-hours window (so the notification should be held back).
   */
  isQuietHour(prefs: UserPreferences, nowMs = Date.now()): boolean {
    if (!prefs.quietHours) return false;
    const { startHour, endHour, timezone } = prefs.quietHours;
    const hourStr = new Date(nowMs).toLocaleString('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    });
    const h = parseInt(hourStr, 10);
    // Handle windows that wrap midnight (e.g. 22–06)
    if (startHour <= endHour) return h >= startHour && h < endHour;
    return h >= startHour || h < endHour;
  }

  /**
   * Returns the effective delivery channels for a given trigger,
   * respecting any per-trigger override for the user.
   */
  channelsForTrigger(prefs: UserPreferences, trigger: NotificationTrigger): SubscriptionChannel[] {
    const override = prefs.triggerPreferences.find((p) => p.trigger === trigger);
    if (override) return override.enabled ? override.channels : [];
    return prefs.enabledChannels;
  }
}

export const preferencesService = new PreferencesService();
