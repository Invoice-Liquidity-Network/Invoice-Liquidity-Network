/**
 * packages/sdk/src/schemas/middleware.ts
 *
 * Higher-order function that wraps event handlers with Zod schema validation.
 * Ensures all event data is validated before reaching business logic.
 */

import type { RawEvent } from '../events';
import { parseContractEvent, type ContractEvent } from '../events';
import { validateEvent, EventValidationError, type ValidatedEvent } from './validateEvent';
import { EVENT_SCHEMAS, type EventTypeName } from './events';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Handler that receives a validated, typed contract event. */
export type ValidatedEventHandler<T = ContractEvent> = (
  event: T,
  validation: ValidatedEvent & { ok: true }
) => void | Promise<void>;

/** Handler that receives raw Soroban XDR event data (pre-validation). */
export type RawEventHandler = (raw: RawEvent) => void | Promise<void>;

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Wrap an event handler with Zod schema validation.
 *
 * The middleware:
 * 1. Parses the raw XDR event using the existing `parseContractEvent()` function
 * 2. Maps the SDK's event type name to the Zod schema event type
 * 3. Validates the parsed event against the corresponding Zod schema
 * 4. Calls the wrapped handler only if validation passes
 * 5. Throws `EventValidationError` if validation fails
 *
 * @param handler - The event handler to wrap.
 * @param options - Optional configuration.
 * @param options.onError - Custom error handler (default: throw).
 * @returns A new handler that validates before calling the original.
 *
 * @example
 * ```ts
 * import { withEventValidation } from '@iln/sdk/schemas';
 *
 * const safeHandler = withEventValidation((event) => {
 *   // event is fully validated and typed
 *   console.log(event.type, event.invoiceId);
 * });
 *
 * // Use with raw Soroban events
 * await safeHandler(rawEvent);
 * ```
 */
export function withEventValidation<T extends ContractEvent = ContractEvent>(
  handler: ValidatedEventHandler<T>,
  options?: {
    onError?: (error: EventValidationError) => void;
  }
): RawEventHandler {
  return async (raw: RawEvent): Promise<void> => {
    // Step 1: Parse XDR event
    const parsed = parseContractEvent(raw);

    if (!parsed) {
      const error = new EventValidationError('Unable to parse event from raw XDR data.', {
        issues: [
          {
            path: [],
            message: 'parseContractEvent() returned null.',
            code: 'parse_error',
          },
        ],
        context: { hasTopics: !!raw?.topics, topicCount: raw?.topics?.length },
      });

      if (options?.onError) {
        options.onError(error);
        return;
      }
      throw error;
    }

    // Step 2: Map SDK event type to Zod schema event type
    // The SDK uses different type names in some cases (e.g., 'InvoiceSubmitted' vs 'InvoiceSubmitted')
    const eventType = parsed.type as EventTypeName;

    // Step 3: Validate against Zod schema
    const result = validateEvent(parsed, { eventType });

    if (!result.ok) {
      if (options?.onError) {
        options.onError(result.error);
        return;
      }
      throw result.error;
    }

    // Step 4: Call handler with validated event
    await handler(result.event as T, result as ValidatedEvent & { ok: true });
  };
}

/**
 * Create a validated event handler that can process multiple event types.
 *
 * This is useful for handlers that need to process different event types
 * with type-safe access to each event's fields.
 *
 * @param handlers - Map of event type to handler function.
 * @param options - Optional configuration.
 * @returns A single handler that validates and dispatches to the appropriate handler.
 *
 * @example
 * ```ts
 * import { createValidatedHandler } from '@iln/sdk/schemas';
 *
 * const handler = createValidatedHandler({
 *   InvoiceSubmitted: (event) => {
 *     console.log('New invoice:', event.invoiceId);
 *   },
 *   InvoiceFunded: (event) => {
 *     console.log('Invoice funded:', event.invoiceId, event.funder);
 *   },
 * });
 *
 * await handler(rawEvent);
 * ```
 */
export function createValidatedHandler(
  handlers: Partial<Record<EventTypeName, ValidatedEventHandler>>,
  options?: {
    onError?: (error: EventValidationError) => void;
    onUnhandled?: (eventType: string) => void;
  }
): RawEventHandler {
  return async (raw: RawEvent): Promise<void> => {
    // Parse XDR event
    const parsed = parseContractEvent(raw);

    if (!parsed) {
      const error = new EventValidationError('Unable to parse event from raw XDR data.', {
        issues: [
          {
            path: [],
            message: 'parseContractEvent() returned null.',
            code: 'parse_error',
          },
        ],
      });

      if (options?.onError) {
        options.onError(error);
        return;
      }
      throw error;
    }

    const eventType = parsed.type as EventTypeName;

    // Check if we have a handler for this event type
    if (!handlers[eventType]) {
      options?.onUnhandled?.(eventType);
      return;
    }

    // Validate
    const result = validateEvent(parsed, { eventType });

    if (!result.ok) {
      if (options?.onError) {
        options.onError(result.error);
        return;
      }
      throw result.error;
    }

    // Dispatch to handler
    await handlers[eventType]!(result.event as ContractEvent, result as ValidatedEvent & { ok: true });
  };
}
