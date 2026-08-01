import { Router, type Request, type Response } from "express";
import { scheduleReminders, type ReminderInvoice, type ReminderPreferences, type ReminderSchedule, type ScheduledReminder } from "./reminders";

export interface ReminderContext { invoice: ReminderInvoice; preferences: ReminderPreferences; }
export interface ReminderStore { save(reminders: ScheduledReminder[], context?: ReminderContext): void; byInvoice(invoiceId: string): ScheduledReminder[]; get(id: string): ScheduledReminder | undefined; update(id: string, schedule: ReminderSchedule): ScheduledReminder[]; cancel(id: string): boolean; }

export class InMemoryReminderStore implements ReminderStore {
  private readonly reminders = new Map<string, ScheduledReminder>();
  private readonly contexts = new Map<string, ReminderContext>();
  save(reminders: ScheduledReminder[], context?: ReminderContext): void { if (context) this.contexts.set(String(context.invoice.id), context); for (const reminder of reminders) this.reminders.set(reminder.id, reminder); }
  byInvoice(invoiceId: string): ScheduledReminder[] { return [...this.reminders.values()].filter((reminder) => reminder.invoiceId === invoiceId); }
  get(id: string): ScheduledReminder | undefined { return this.reminders.get(id); }
  update(id: string, schedule: ReminderSchedule): ScheduledReminder[] {
    const current = this.get(id);
    if (!current) return [];
    const context = this.contexts.get(current.invoiceId);
    if (!context) return [];
    for (const reminder of this.byInvoice(current.invoiceId)) if (reminder.status === "scheduled") reminder.status = "cancelled";
    const replacement = scheduleReminders(context.invoice, { ...context.preferences, schedule }, { now: new Date() });
    this.contexts.set(current.invoiceId, { invoice: context.invoice, preferences: { ...context.preferences, schedule } });
    this.save(replacement);
    return replacement;
  }
  cancel(id: string): boolean { const reminder = this.get(id); if (!reminder || reminder.status !== "scheduled") return false; reminder.status = "cancelled"; return true; }
}

function validPreferences(value: unknown): value is ReminderPreferences {
  if (!value || typeof value !== "object") return false;
  const preferences = value as ReminderPreferences;
  if (typeof preferences.timezone !== "string" || !Array.isArray(preferences.holidays) || !preferences.holidays.every((holiday) => typeof holiday === "string")) return false;
  if (preferences.quietHours !== null) {
    if (!preferences.quietHours || !Number.isInteger(preferences.quietHours.startHour) || !Number.isInteger(preferences.quietHours.endHour)) return false;
    if (preferences.quietHours.startHour < 0 || preferences.quietHours.startHour > 23 || preferences.quietHours.endHour < 0 || preferences.quietHours.endHour > 23) return false;
  }
  return true;
}

export function createRemindersRouter(store: ReminderStore = new InMemoryReminderStore()): Router {
  const router = Router();
  router.post("/subscribe", (req: Request, res: Response) => {
    const body = req.body as { invoice?: ReminderInvoice; preferences?: ReminderPreferences };
    if (!body?.invoice || body.invoice.id === undefined || !body.invoice.payer || body.invoice.dueDate === undefined) return res.status(400).json({ error: "invoice.id, invoice.payer, and invoice.dueDate are required" });
    if (!validPreferences(body.preferences)) return res.status(400).json({ error: "valid preferences are required" });
    try { const reminders = scheduleReminders(body.invoice, body.preferences); store.save(reminders, { invoice: body.invoice, preferences: body.preferences }); return res.status(201).json({ reminders }); } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid reminder request" }); }
  });
  router.get("/:invoiceId", (req: Request, res: Response) => res.json({ reminders: store.byInvoice(req.params.invoiceId) }));
  router.delete("/:id", (req: Request, res: Response) => { if (!store.cancel(req.params.id)) return res.status(404).json({ error: "Reminder not found" }); return res.status(204).send(); });
  router.put("/:id", (req: Request, res: Response) => {
    const schedule = req.body as ReminderSchedule;
    if (!schedule || !Array.isArray(schedule.beforeDueDays) || !Array.isArray(schedule.afterDueDays)) return res.status(400).json({ error: "beforeDueDays and afterDueDays must be arrays" });
    try { const reminders = store.update(req.params.id, schedule); if (reminders.length === 0) return res.status(404).json({ error: "Reminder not found" }); return res.json({ reminders }); } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid reminder schedule" }); }
  });
  return router;
}
