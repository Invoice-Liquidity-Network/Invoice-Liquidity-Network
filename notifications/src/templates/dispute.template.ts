/**
 * Email template: Invoice Defaulted / Dispute Opened (#446)
 *
 * Sent to the freelancer and LP when a payer fails to settle an invoice and
 * it transitions to the "Defaulted" state.
 */

import { emailShell, escapeHtml, formatAmount, formatDate, shortAddress } from "./helpers";
import type { InvoiceEvent } from "../types";

export interface DisputeTemplateVars {
  event: InvoiceEvent;
  /** Role of the recipient */
  recipientRole: "freelancer" | "lp";
  dashboardUrl?: string;
  /** Optional tokenized one-click unsubscribe URL. */
  unsubscribeUrl?: string;
}

/**
 * Build the subject line for a dispute/default notification.
 */
export function buildDisputeSubject(event: InvoiceEvent): string {
  return `Invoice #${event.invoiceId} has defaulted – action may be required`;
}

/**
 * Render the full HTML email body for an invoice-defaulted event.
 */
export function renderDisputeEmail(vars: DisputeTemplateVars): string {
  const { event, recipientRole, dashboardUrl, unsubscribeUrl } = vars;

  const isFreelancer = recipientRole === "freelancer";
  const roleLabel = isFreelancer ? "Freelancer" : "Liquidity Provider";

  const formattedAmount = escapeHtml(formatAmount(event.amount));
  const formattedDue = escapeHtml(formatDate(event.dueDate));
  const funderDisplay = event.funder ? escapeHtml(shortAddress(event.funder)) : "—";
  const freelancerDisplay = escapeHtml(shortAddress(event.freelancer));
  const payerDisplay = escapeHtml(shortAddress(event.payer));
  const invoiceId = String(event.invoiceId);
  const dashUrl = dashboardUrl ?? `https://iln.finance/invoices/${invoiceId}`;

  const body = `
    <div class="header" style="background-color: #dc2626;">
      <h1>Invoice Defaulted</h1>
      <p>Invoice Liquidity Network</p>
    </div>
    <div class="body-content">
      <h2>Invoice #${escapeHtml(invoiceId)} has defaulted.</h2>
      <p>
        ${escapeHtml(roleLabel)}, we regret to inform you that
        <strong>Invoice #${escapeHtml(invoiceId)}</strong> was not settled by the due date
        and has been marked as <strong>Defaulted</strong>.
      </p>

      <div class="invoice-card">
        <table>
          <tr>
            <td class="label">Invoice ID</td>
            <td>#${escapeHtml(invoiceId)}</td>
          </tr>
          <tr>
            <td class="label">Status</td>
            <td><span class="badge badge-default">Defaulted</span></td>
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
          ${
            event.funder
              ? `<tr>
                   <td class="label">Funded By</td>
                   <td>${funderDisplay}</td>
                 </tr>`
              : ""
          }
        </table>
      </div>

      <p>
        ${
          isFreelancer
            ? "The insurance pool may cover part of your exposure. Please review your account on the dashboard for next steps."
            : "The default recovery process has been initiated. The insurance pool will handle your claim automatically. Visit the dashboard to review your recovery status."
        }
      </p>

      <p style="font-size:13px; color:#6b7280;">
        If you believe this is an error or have questions, please contact
        <a href="mailto:support@iln.finance">support@iln.finance</a>.
      </p>

      <div class="btn-wrap">
        <a href="${escapeHtml(dashUrl)}" class="btn" style="background-color:#dc2626;">
          View Invoice
        </a>
      </div>
    </div>`;

  return emailShell(`Invoice #${invoiceId} Defaulted`, body, { unsubscribeUrl });
}
