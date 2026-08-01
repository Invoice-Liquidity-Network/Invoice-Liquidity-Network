/**
 * Email template: Invoice Funded (#446)
 *
 * Sent to the freelancer (and optionally the payer) when a liquidity provider
 * funds their invoice.
 */

import { emailShell, escapeHtml, formatAmount, formatDate, shortAddress } from "./helpers";
import type { InvoiceEvent } from "../types";

export interface FundedTemplateVars {
  event: InvoiceEvent;
  /** Role of the recipient: "freelancer" | "payer" */
  recipientRole: "freelancer" | "payer";
  /** Optional dashboard link for the invoice */
  dashboardUrl?: string;
  /** Optional tokenized one-click unsubscribe URL. Falls back to the
   *  public marketing URL when omitted. */
  unsubscribeUrl?: string;
}

/**
 * Build the subject line for a funded notification.
 */
export function buildFundedSubject(event: InvoiceEvent): string {
  return `Invoice #${event.invoiceId} has been funded – funds on the way`;
}

/**
 * Render the full HTML email body for an invoice-funded event.
 */
export function renderFundedEmail(vars: FundedTemplateVars): string {
  const { event, recipientRole, dashboardUrl, unsubscribeUrl } = vars;

  const isFreelancer = recipientRole === "freelancer";
  const greeting = isFreelancer
    ? "Great news — your invoice has been funded!"
    : "An invoice you are associated with has been funded.";

  const formattedAmount = escapeHtml(formatAmount(event.amount));
  const formattedDue = escapeHtml(formatDate(event.dueDate));
  const funderDisplay = event.funder ? escapeHtml(shortAddress(event.funder)) : "Unknown";
  const freelancerDisplay = escapeHtml(shortAddress(event.freelancer));
  const payerDisplay = escapeHtml(shortAddress(event.payer));
  const invoiceId = String(event.invoiceId);
  const dashUrl = dashboardUrl ?? `https://iln.finance/invoices/${invoiceId}`;

  const body = `
    <div class="header">
      <h1>Invoice Funded</h1>
      <p>Invoice Liquidity Network</p>
    </div>
    <div class="body-content">
      <h2>${escapeHtml(greeting)}</h2>
      <p>
        A liquidity provider has funded
        <strong>Invoice #${escapeHtml(invoiceId)}</strong>.
        ${isFreelancer ? "The discounted amount will be released according to the contract terms." : ""}
      </p>

      <div class="invoice-card">
        <table>
          <tr>
            <td class="label">Invoice ID</td>
            <td>#${escapeHtml(invoiceId)}</td>
          </tr>
          <tr>
            <td class="label">Status</td>
            <td><span class="badge badge-funded">Funded</span></td>
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
          <tr>
            <td class="label">Funded By</td>
            <td>${funderDisplay}</td>
          </tr>
        </table>
      </div>

      <p>
        ${
          isFreelancer
            ? "You can view the full details and track payment progress in your dashboard."
            : "Please ensure payment is made by the due date to avoid penalties."
        }
      </p>

      <div class="btn-wrap">
        <a href="${escapeHtml(dashUrl)}" class="btn">View Invoice</a>
      </div>
    </div>`;

  return emailShell(`Invoice #${invoiceId} Funded`, body, { unsubscribeUrl });
}
