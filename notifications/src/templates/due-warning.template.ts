/**
 * Email template: Invoice Due Soon – 48-hour warning (#446)
 *
 * Sent to the freelancer when an invoice is 48 hours from its due date.
 */

import { emailShell, escapeHtml, formatAmount, formatDate, shortAddress } from "./helpers";
import type { InvoiceEvent } from "../types";

export interface DueWarningTemplateVars {
  event: InvoiceEvent;
  dashboardUrl?: string;
  /** Optional tokenized one-click unsubscribe URL. */
  unsubscribeUrl?: string;
}

/**
 * Build the subject line for a due-date warning.
 */
export function buildDueWarningSubject(event: InvoiceEvent): string {
  return `Invoice #${event.invoiceId} is due in 48 hours – reminder`;
}

/**
 * Render the full HTML email body for a due-date warning.
 */
export function renderDueWarningEmail(vars: DueWarningTemplateVars): string {
  const { event, dashboardUrl, unsubscribeUrl } = vars;

  const formattedAmount = escapeHtml(formatAmount(event.amount));
  const formattedDue = escapeHtml(formatDate(event.dueDate));
  const payerDisplay = escapeHtml(shortAddress(event.payer));
  const freelancerDisplay = escapeHtml(shortAddress(event.freelancer));
  const invoiceId = String(event.invoiceId);
  const dashUrl = dashboardUrl ?? `https://iln.finance/invoices/${invoiceId}`;

  const body = `
    <div class="header" style="background-color: #d97706;">
      <h1>Invoice Due Soon</h1>
      <p>Invoice Liquidity Network</p>
    </div>
    <div class="body-content">
      <h2>Invoice #${escapeHtml(invoiceId)} is due in 48 hours.</h2>
      <p>
        This is a reminder that <strong>Invoice #${escapeHtml(invoiceId)}</strong> is due
        within the next 48 hours. Please ensure the payer has made arrangements to settle
        the balance on time.
      </p>

      <div class="invoice-card">
        <table>
          <tr>
            <td class="label">Invoice ID</td>
            <td>#${escapeHtml(invoiceId)}</td>
          </tr>
          <tr>
            <td class="label">Status</td>
            <td><span class="badge badge-warning">Due Soon</span></td>
          </tr>
          <tr>
            <td class="label">Amount</td>
            <td>${formattedAmount} XLM</td>
          </tr>
          <tr>
            <td class="label">Due Date</td>
            <td>${formattedDue}</td>
          </tr>
          <tr>
            <td class="label">Freelancer</td>
            <td>${freelancerDisplay}</td>
          </tr>
          <tr>
            <td class="label">Payer</td>
            <td>${payerDisplay}</td>
          </tr>
        </table>
      </div>

      <p>
        If the invoice is not settled by the due date it may enter the default process,
        which could affect reputation scores and insurance coverage.
      </p>

      <div class="btn-wrap">
        <a href="${escapeHtml(dashUrl)}" class="btn" style="background-color:#d97706;">
          View Invoice
        </a>
      </div>
    </div>`;

  return emailShell(`Invoice #${invoiceId} Due in 48 Hours`, body, { unsubscribeUrl });
}
