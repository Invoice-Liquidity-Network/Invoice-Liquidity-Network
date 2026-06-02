export type InvoiceStatus = 'Pending' | 'Funded' | 'Paid' | 'Defaulted';
export type ILNEventType = 'submitted' | 'funded' | 'paid' | 'defaulted';

export type NotificationTrigger =
  | 'invoice_funded'
  | 'invoice_paid'
  | 'invoice_defaulted'
  | 'invoice_due_soon'
  | 'invoice_overdue';

export type SubscriptionChannel = 'email' | 'webhook';

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

export interface Subscription {
  id: number;
  stellar_address: string;
  channel: SubscriptionChannel;
  destination: string;
  triggers: NotificationTrigger[];
  created_at: number;
}

export interface NotificationPayload {
  trigger: NotificationTrigger;
  invoice: Invoice;
  recipientAddress: string;
  subject: string;
  message: string;
  actor: 'freelancer' | 'lp' | 'payer';
  eventType?: ILNEventType;
}
