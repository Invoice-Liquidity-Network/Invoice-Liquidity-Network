export type ReminderKind = "pre_due" | "due_today" | "overdue" | "escalation";

export interface ReminderSchedule { beforeDueDays: number[]; afterDueDays: number[]; }
export interface ReminderPreferences { timezone: string; quietHours: { startHour: number; endHour: number } | null; holidays: string[]; schedule?: Partial<ReminderSchedule>; }
export interface ReminderInvoice { id: string | number; dueDate: string | number | Date; payer: string; }
export interface ScheduledReminder { id: string; invoiceId: string; payer: string; kind: ReminderKind; daysFromDue: number; scheduledAt: string; subject: string; message: string; status: "scheduled" | "cancelled" | "sent"; }

export const DEFAULT_REMINDER_SCHEDULE: ReminderSchedule = { beforeDueDays: [7, 3, 1], afterDueDays: [1, 3, 7, 14] };

function asDate(value: string | number | Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : typeof value === "number" ? new Date(value < 10_000_000_000 ? value * 1000 : value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("dueDate must be a valid date");
  return date;
}

function dateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function zonedParts(date: Date, timezone: string): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hour12: false }).formatToParts(date);
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour") };
}

function isQuietHour(date: Date, preferences: ReminderPreferences): boolean {
  if (!preferences.quietHours) return false;
  const hour = zonedParts(date, preferences.timezone).hour;
  const { startHour, endHour } = preferences.quietHours;
  return startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

function isBlockedDate(date: Date, preferences: ReminderPreferences): boolean {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: preferences.timezone, weekday: "short" }).format(date);
  return day === "Sat" || day === "Sun" || preferences.holidays.includes(dateKey(date, preferences.timezone));
}

function moveToDeliverableTime(date: Date, preferences: ReminderPreferences): Date {
  const result = new Date(date.getTime());
  for (let attempts = 0; attempts < 370; attempts += 1) {
    if (!isBlockedDate(result, preferences) && !isQuietHour(result, preferences)) return result;
    result.setUTCMinutes(result.getUTCMinutes() + 60);
  }
  throw new Error("Unable to find a deliverable reminder time");
}

function mergeSchedule(preferences: ReminderPreferences): ReminderSchedule {
  const before = preferences.schedule?.beforeDueDays ?? DEFAULT_REMINDER_SCHEDULE.beforeDueDays;
  const after = preferences.schedule?.afterDueDays ?? DEFAULT_REMINDER_SCHEDULE.afterDueDays;
  if (!before.every((day) => Number.isInteger(day) && day > 0) || !after.every((day) => Number.isInteger(day) && day > 0)) throw new Error("Reminder schedule days must be positive integers");
  return { beforeDueDays: [...new Set(before)].sort((a, b) => b - a), afterDueDays: [...new Set(after)].sort((a, b) => a - b) };
}

function reminderText(invoiceId: string, kind: ReminderKind, days: number): { subject: string; message: string } {
  if (kind === "due_today") return { subject: `Invoice #${invoiceId} is due today`, message: `Invoice #${invoiceId} is due today` };
  if (kind === "overdue" || kind === "escalation") {
    const prefix = kind === "escalation" ? "Action required: " : "";
    return { subject: `${prefix}Invoice #${invoiceId} is ${days} days overdue`, message: `${prefix}Invoice #${invoiceId} is ${days} days overdue` };
  }
  return { subject: `Invoice #${invoiceId} is due in ${days} days`, message: `Invoice #${invoiceId} is due in ${days} days` };
}

export function scheduleReminders(invoice: ReminderInvoice, preferences: ReminderPreferences, options: { now?: Date; payerDates?: Set<string> } = {}): ScheduledReminder[] {
  const dueDate = asDate(invoice.dueDate);
  const schedule = mergeSchedule(preferences);
  const now = options.now ?? new Date();
  const payerDates = options.payerDates ?? new Set<string>();
  const entries: Array<{ offset: number; kind: ReminderKind; days: number }> = [];
  for (const days of schedule.beforeDueDays) entries.push({ offset: -days, kind: "pre_due", days });
  entries.push({ offset: 0, kind: "due_today", days: 0 });
  for (const days of schedule.afterDueDays) entries.push({ offset: days, kind: days >= 7 ? "escalation" : "overdue", days });
  const result: ScheduledReminder[] = [];
  for (const entry of entries) {
    const candidate = new Date(dueDate.getTime() + entry.offset * 86_400_000);
    if (candidate <= now) continue;
    let deliverAt = moveToDeliverableTime(candidate, preferences);
    for (let attempts = 0; attempts < 370 && payerDates.has(dateKey(deliverAt, preferences.timezone)); attempts += 1) deliverAt = moveToDeliverableTime(new Date(deliverAt.getTime() + 86_400_000), preferences);
    const payerDate = dateKey(deliverAt, preferences.timezone);
    payerDates.add(payerDate);
    const text = reminderText(String(invoice.id), entry.kind, entry.days);
    result.push({ id: `${String(invoice.id)}-${entry.kind}-${entry.days}-${deliverAt.getTime()}`, invoiceId: String(invoice.id), payer: invoice.payer, kind: entry.kind, daysFromDue: entry.offset, scheduledAt: deliverAt.toISOString(), subject: text.subject, message: text.message, status: "scheduled" });
  }
  return result;
}

export function isWithinQuietHours(date: Date, preferences: ReminderPreferences): boolean { return isQuietHour(date, preferences); }
export function isNonDeliveryDate(date: Date, preferences: ReminderPreferences): boolean { return isBlockedDate(date, preferences); }
