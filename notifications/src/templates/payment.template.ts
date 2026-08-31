/**
 * Email template: Invoice Payment Received (#446)
 *
 * Sent to the freelancer and the LP (funder) once the payer settles an invoice.
 */

import { emailShell, escapeHtml, formatAmount, formatDate, shortAddress } from './helpers';
import type { InvoiceEvent } from '../types';

export interface PaymentTemplateVars {
  event: InvoiceEvent;
  /** Role of the recipient */
  recipientRole: 'freelancer' | 'lp';
  dashboardUrl?: string;
  /** Optional tokenized one-click unsubscribe URL. */
  unsubscribeUrl?: string;
}

/**
 * Build the subject line for a payment-received notification.
 */
export function buildPaymentSubject(event: InvoiceEvent): string {
  return `Invoice #${event.invoiceId} has been settled – payment received`;
}

/**
 * Render the full HTML email body for an invoice-paid event.
 */
export function renderPaymentEmail(vars: PaymentTemplateVars): string {
  const { event, recipientRole, dashboardUrl, unsubscribeUrl } = vars;

  const isFreelancer = recipientRole === 'freelancer';
  const roleLabel = isFreelancer ? 'Freelancer' : 'Liquidity Provider';
  const greeting = isFreelancer
    ? 'Your invoice has been paid in full.'
    : 'The invoice you funded has been settled.';

  const formattedAmount = escapeHtml(formatAmount(event.amount));
  const formattedDue = escapeHtml(formatDate(event.dueDate));
  const funderDisplay = event.funder ? escapeHtml(shortAddress(event.funder)) : '—';
  const freelancerDisplay = escapeHtml(shortAddress(event.freelancer));
  const payerDisplay = escapeHtml(shortAddress(event.payer));
  const invoiceId = String(event.invoiceId);
  const dashUrl = dashboardUrl ?? `https://iln.finance/invoices/${invoiceId}`;

  const body = `
    <div class="header">
      <h1>Payment Received</h1>
      <p>Invoice Liquidity Network</p>
    </div>
    <div class="body-content">
      <h2>${escapeHtml(greeting)}</h2>
      <p>
        ${escapeHtml(roleLabel)}, <strong>Invoice #${escapeHtml(invoiceId)}</strong> has been
        fully settled by the payer. All parties have been notified.
      </p>

      <div class="invoice-card">
        <table>
          <tr>
            <td class="label">Invoice ID</td>
            <td>#${escapeHtml(invoiceId)}</td>
          </tr>
          <tr>
            <td class="label">Status</td>
            <td><span class="badge badge-paid">Paid</span></td>
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
              : ''
          }
        </table>
      </div>

      <p>
        ${
          isFreelancer
            ? 'Thank you for using Invoice Liquidity Network. The full settlement is now complete.'
            : 'Your yield has been credited. View your portfolio for the updated yield summary.'
        }
      </p>

      <div class="btn-wrap">
        <a href="${escapeHtml(dashUrl)}" class="btn">View Invoice</a>
      </div>
    </div>`;

  return emailShell(`Invoice #${invoiceId} Settled`, body, { unsubscribeUrl });
}
