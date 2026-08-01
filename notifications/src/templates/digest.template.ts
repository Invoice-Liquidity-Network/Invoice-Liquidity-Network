/**
 * Email template: Notification Digest (#496)
 *
 * Renders a daily or weekly digest of invoice activity for a single user.
 * Each digest item represents one invoice event that occurred during the window.
 */

import { emailShell, escapeHtml, formatAmount, formatDate, shortAddress } from "./helpers";

export interface DigestItem {
  invoiceId: number;
  eventType: string;
  amount: string;
  freelancer: string;
  payer: string;
  dueDate: number;
  occurredAt: number;
}

export interface DigestTemplateVars {
  recipientAddress: string;
  frequency: "daily" | "weekly";
  items: DigestItem[];
  unsubscribeToken: string;
  periodLabel: string;
  dashboardUrl?: string;
}

export function buildDigestSubject(vars: Pick<DigestTemplateVars, "frequency" | "items">): string {
  const { frequency, items } = vars;
  const count = items.length;
  const period = frequency === "daily" ? "Daily" : "Weekly";
  if (count === 0) return `Your ${period} Invoice Digest — No activity`;
  if (count === 1) return `Your ${period} Invoice Digest — 1 update`;
  return `Your ${period} Invoice Digest — ${count} updates`;
}

function eventBadgeClass(eventType: string): string {
  switch (eventType) {
    case "funded": return "badge-funded";
    case "paid": return "badge-paid";
    case "defaulted": return "badge-default";
    case "due_date_warning": return "badge-warning";
    default: return "badge-funded";
  }
}

function eventLabel(eventType: string): string {
  switch (eventType) {
    case "funded": return "Funded";
    case "paid": return "Paid";
    case "defaulted": return "Defaulted";
    case "due_date_warning": return "Due Soon";
    default: return eventType;
  }
}

function renderDigestRow(item: DigestItem): string {
  const badgeClass = eventBadgeClass(item.eventType);
  const label = escapeHtml(eventLabel(item.eventType));
  const amount = escapeHtml(formatAmount(item.amount));
  const dueDate = escapeHtml(formatDate(item.dueDate));
  const freelancer = escapeHtml(shortAddress(item.freelancer));
  const payer = escapeHtml(shortAddress(item.payer));
  const invoiceId = escapeHtml(String(item.invoiceId));
  const occurred = escapeHtml(new Date(item.occurredAt).toUTCString());

  return `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 12px 8px; font-size: 13px;">
        <a href="https://iln.finance/invoices/${invoiceId}" style="color: #1a56db; text-decoration: none; font-weight: 600;">
          #${invoiceId}
        </a>
        <div style="font-size: 11px; color: #9ca3af; margin-top: 2px;">${occurred}</div>
      </td>
      <td style="padding: 12px 8px; font-size: 13px;">
        <span class="badge ${badgeClass}">${label}</span>
      </td>
      <td style="padding: 12px 8px; font-size: 13px; color: #374151;">${amount} XLM</td>
      <td style="padding: 12px 8px; font-size: 13px; color: #6b7280;">${freelancer}</td>
      <td style="padding: 12px 8px; font-size: 13px; color: #6b7280;">${payer}</td>
      <td style="padding: 12px 8px; font-size: 13px; color: #6b7280;">${dueDate}</td>
    </tr>`;
}

function renderEmptyState(): string {
  return `
    <div style="text-align: center; padding: 40px 20px; color: #9ca3af;">
      <p style="font-size: 16px;">No invoice activity during this period.</p>
      <p style="font-size: 13px;">We will include updates in your next digest when there is activity.</p>
    </div>`;
}

export function renderDigestEmail(vars: DigestTemplateVars): string {
  const { recipientAddress, frequency, items, unsubscribeToken, periodLabel, dashboardUrl } = vars;

  const periodText = frequency === "daily" ? "Daily" : "Weekly";
  const dashUrl = dashboardUrl ?? "https://iln.finance";
  const unsubUrl = `https://iln.finance/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  // The tokenized URL is also passed to the shell so the footer link is the
  // same one-click endpoint the body link hits. They are functionally the same
  // so users have two clearly-marked, working unsubscribe entry points.
  const recipient = escapeHtml(shortAddress(recipientAddress));

  const tableRows = items.length > 0
    ? items.map(renderDigestRow).join("")
    : "";

  const summaryLine = items.length === 0
    ? "No activity to report for this period."
    : `You have <strong>${items.length}</strong> invoice update${items.length !== 1 ? "s" : ""} during ${escapeHtml(periodLabel)}.`;

  const body = `
    <div class="header">
      <h1>Your ${escapeHtml(periodText)} Digest</h1>
      <p>Invoice Liquidity Network — ${escapeHtml(periodLabel)}</p>
    </div>
    <div class="body-content">
      <h2>Hello, ${recipient}</h2>
      <p>${summaryLine}</p>

      ${items.length === 0 ? renderEmptyState() : `
      <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
        <thead>
          <tr style="background-color: #f9fafb; border-bottom: 2px solid #e5e7eb;">
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Invoice</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Event</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Amount</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Freelancer</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Payer</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Due Date</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      `}

      <div class="btn-wrap">
        <a href="${escapeHtml(dashUrl)}" class="btn">Go to Dashboard</a>
      </div>

      <p style="font-size: 13px; color: #9ca3af; margin-top: 32px;">
        You are receiving this ${periodText.toLowerCase()} digest because you have digest notifications enabled
        for address <strong>${recipient}</strong>.
        <a href="${escapeHtml(unsubUrl)}" style="color: #6b7280;">Unsubscribe or change frequency</a>.
      </p>
    </div>`;

  return emailShell(`Your ${periodText} Invoice Digest`, body, { unsubscribeUrl: unsubUrl });
}
