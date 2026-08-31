/**
 * All nine on-chain invoice states.
 *
 * Intentionally differs from @iln/shared's InvoiceStatus only in that this is
 * a local copy kept in sync with the contract. If a new status is added to the
 * contract, it must be added here as well.
 */
export type InvoiceStatus =
  | 'Pending'
  | 'PartiallyFunded'
  | 'Funded'
  | 'Paid'
  | 'Defaulted'
  | 'Appealed'
  | 'Disputed'
  | 'Expired'
  | 'Cancelled';
export type ILNEventType = 'submitted' | 'funded' | 'paid' | 'defaulted';

export type NotificationTrigger =
  | 'invoice_funded'
  | 'invoice_paid'
  | 'invoice_defaulted'
  | 'invoice_due_soon'
  | 'invoice_overdue';

export type SubscriptionChannel = 'email' | 'webhook' | 'sms' | 'websocket';

/** Roles used in the service layer (service.ts / NotificationService). */
export type ActorRole = 'freelancer' | 'lp' | 'payer';

/** Webhook health status tracked per subscription. */
export type WebhookStatus = 'active' | 'failed' | 'disabled';

/**
 * A normalised invoice event emitted by the contract poller and consumed by
 * the notification service.
 */
export interface InvoiceEvent {
  eventId: string;
  type: string; // e.g. "funded" | "paid" | "defaulted" | "due_date_warning"
  invoiceId: number;
  freelancer: string;
  payer: string;
  funder?: string | null;
  amount: string;
  dueDate: number;
  discountRate: number;
}

/** Result returned by the service after attempting delivery to one subscriber. */
export interface DeliveryResult {
  success: boolean;
  channel: 'email' | 'webhook';
  subscriptionId: string;
}

/**
 * A subscriber record stored in the database. Extends the legacy
 * Subscription shape with service-layer fields used by NotificationService.
 */
export interface Subscription {
  id: string;
  address: string;
  role: ActorRole;
  channel: 'email' | 'webhook';
  email?: string;
  webhookUrl?: string;
  webhookStatus: WebhookStatus;
  active: boolean;
}

/**
 * Invoice as stored in the notifications database.
 *
 * This is a DB-specific projection, not a duplicate of @iln/shared's Invoice.
 * Field names use snake_case to match the SQL schema, `amount` is a string
 * (i128 exceeds JS Number.MAX_SAFE_INTEGER), and it omits contract-only fields
 * like `token`, `amountFunded`, `submitterReputation`, auction fields, etc.
 */
export interface Invoice {
  id: number;
  freelancer: string;
  payer: string;
  amount: string;
  due_date: number;
  discount_rate: number;
  status: InvoiceStatus;
  funder: string | null;
  funded_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface WebhookDeliveryLog {
  id: number;
  subscription_id: number;
  event_id: string | null;
  trigger: NotificationTrigger;
  invoice_id: number;
  recipient_address: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  response_status: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface NotificationPayload {
  trigger: NotificationTrigger;
  invoice: Invoice;
  recipientAddress: string;
  subject: string;
  message: string;
  actor: 'freelancer' | 'lp' | 'payer';
  eventId?: string;
  eventType?: ILNEventType;
}

export interface WebSocketClient {
  id: string;
  address: string;
  socket: WebSocket;
  subscribedAddresses: Set<string>;
  lastHeartbeat: number;
  isAlive: boolean;
}

export interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'event' | 'heartbeat' | 'error';
  payload?: unknown;
  address?: string;
  timestamp?: number;
}
