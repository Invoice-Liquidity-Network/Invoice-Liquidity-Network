/**
 * packages/sdk/src/schemas/validateEvent.ts
 *
 * Runtime validation of contract event data against Zod schemas.
 * Returns a discriminated union: typed event on success, structured error on failure.
 */

import { type ZodSchema, type ZodIssue } from 'zod';
import { ILNError } from '../errors';
import {
  EVENT_SCHEMAS,
  SCHEMA_VERSION,
  type EventTypeName,
  type ValidatedContractEvent,
} from './events';

// ─── Error class ────────────────────────────────────────────────────────────

/**
 * Thrown when event data fails schema validation.
 *
 * Extends ILNError to integrate with the existing error hierarchy.
 * The `context` field contains the Zod issues for programmatic inspection.
 */
export class EventValidationError extends ILNError {
  /** The event type that failed validation (if detectable). */
  public readonly eventType?: string;
  /** Zod validation issues for programmatic inspection. */
  public readonly issues: Array<{
    path: (string | number)[];
    message: string;
    code: string;
    [key: string]: unknown;
  }>;

  constructor(
    message: string,
    options: {
      eventType?: string;
      issues:
        | ZodIssue[]
        | Array<{
            path: (string | number)[];
            message: string;
            code: string;
          }>;
      cause?: unknown;
      context?: Record<string, unknown>;
    }
  ) {
    super(
      message,
      'EVENT_VALIDATION_ERROR',
      'The event data does not match the expected schema. Check the event payload structure and types.',
      {
        docsUrl:
          'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs/errors.md#event_validation_error',
        context: {
          eventType: options.eventType,
          issueCount: options.issues.length,
          ...options.context,
        },
        retryable: false,
        cause: options.cause,
      }
    );
    Object.setPrototypeOf(this, new.target.prototype);
    this.eventType = options.eventType;
    this.issues = options.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
      code: issue.code,
    })) as Array<{
      path: (string | number)[];
      message: string;
      code: string;
    }>;
  }
}

// ─── Result types ───────────────────────────────────────────────────────────

/** Successful validation result. */
export interface ValidatedEventSuccess {
  ok: true;
  event: ValidatedContractEvent;
  schemaVersion: number;
}

/** Failed validation result. */
export interface ValidatedEventFailure {
  ok: false;
  error: EventValidationError;
}

/** Discriminated union result of validateEvent(). */
export type ValidatedEvent = ValidatedEventSuccess | ValidatedEventFailure;

// ─── Validation function ────────────────────────────────────────────────────

/**
 * Detect the event type from the input data.
 * Tries `type` field first (camelCase from contract structs),
 * then falls back to `event` or `eventType` fields.
 */
function detectEventType(data: Record<string, unknown>): string | undefined {
  if (typeof data.type === 'string') return data.type;
  if (typeof data.event === 'string') return data.event;
  if (typeof data.eventType === 'string') return data.eventType;
  return undefined;
}

/**
 * Validate raw event data against the appropriate Zod schema.
 *
 * @param data - The raw event data to validate.
 * @param options - Optional configuration.
 * @param options.schemaVersion - Pin to a specific schema version (default: latest).
 * @param options.eventType - Override event type detection (useful when the
 *   `type` field is not present or uses a different key).
 * @returns A discriminated union: `{ ok: true, event }` or `{ ok: false, error }`.
 *
 * @example
 * ```ts
 * import { validateEvent } from '@iln/sdk/schemas';
 *
 * const raw = {
 *   type: 'InvoiceSubmitted',
 *   invoiceId: 42n,
 *   freelancer: 'GABC...',
 *   payer: 'GDEF...',
 *   token: 'GHIJ...',
 *   amount: 1000000n,
 *   dueDate: 1700000000n,
 *   discountRate: 300,
 *   referralCode: { tag: 'None' },
 *   status: 'Pending',
 *   timestamp: 1699999999n,
 * };
 *
 * const result = validateEvent(raw);
 * if (result.ok) {
 *   console.log(result.event.type); // 'InvoiceSubmitted'
 *   console.log(result.event.invoiceId); // 42n
 * }
 * ```
 */
export function validateEvent(
  data: unknown,
  options?: {
    schemaVersion?: number;
    eventType?: string;
  }
): ValidatedEvent {
  // Guard: must be a non-null object
  if (data === null || data === undefined || typeof data !== 'object') {
    return {
      ok: false,
      error: new EventValidationError('Event data must be a non-null object.', {
        issues: [
          {
            path: [],
            message:
              'Expected a non-null object, received ' + (data === null ? 'null' : typeof data),
            code: 'invalid_type',
          },
        ],
        context: { rawDataType: typeof data },
      }),
    };
  }

  // Detect event type
  const eventType = options?.eventType ?? detectEventType(data as Record<string, unknown>);

  if (!eventType) {
    return {
      ok: false,
      error: new EventValidationError('Unable to detect event type. Expected a "type" field.', {
        issues: [
          {
            path: ['type'],
            message: 'Event type field is missing or not a string.',
            code: 'invalid_type',
          },
        ],
        context: { availableFields: Object.keys(data as Record<string, unknown>) },
      }),
    };
  }

  // Check schema version
  if (options?.schemaVersion !== undefined && options.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: new EventValidationError(
        `Schema version mismatch: requested v${options.schemaVersion}, current is v${SCHEMA_VERSION}.`,
        {
          eventType,
          issues: [
            {
              path: ['schemaVersion'],
              message: `Requested v${options.schemaVersion}, current is v${SCHEMA_VERSION}.`,
              code: 'invalid_value',
            },
          ],
          context: {
            requestedVersion: options.schemaVersion,
            currentVersion: SCHEMA_VERSION,
          },
        }
      ),
    };
  }

  // Look up schema
  const schema: ZodSchema | undefined = EVENT_SCHEMAS[eventType as EventTypeName];

  if (!schema) {
    return {
      ok: false,
      error: new EventValidationError(`Unknown event type: "${eventType}".`, {
        eventType,
        issues: [
          {
            path: ['type'],
            message: `No schema found for event type "${eventType}".`,
            code: 'invalid_value',
          },
        ],
        context: {
          knownTypes: Object.keys(EVENT_SCHEMAS),
        },
      }),
    };
  }

  // Validate
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      ok: true,
      event: result.data as ValidatedContractEvent,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  return {
    ok: false,
    error: new EventValidationError(
      `Validation failed for event type "${eventType}": ${result.error.issues.length} issue(s).`,
      {
        eventType,
        issues: result.error.issues,
        cause: result.error,
      }
    ),
  };
}
