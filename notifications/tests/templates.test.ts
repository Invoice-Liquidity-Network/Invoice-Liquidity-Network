/**
 * Tests for notification email templates (#446)
 *
 * Verifies that:
 *  - All templates render without throwing
 *  - Template variables are properly interpolated
 *  - Subject lines match expected content
 *  - HTML structure is valid (no broken tags, required elements present)
 */

import { describe, expect, it } from "vitest";
import {
  renderFundedEmail,
  buildFundedSubject,
  renderPaymentEmail,
  buildPaymentSubject,
  renderDisputeEmail,
  buildDisputeSubject,
  renderDueWarningEmail,
  buildDueWarningSubject,
  emailShell,
  escapeHtml,
} from "../src/templates";
import type { InvoiceEvent } from "../src/types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FREELANCER = "GFREELANCER000000000000000000000000000000000000000000000001";
const PAYER = "GPAYER00000000000000000000000000000000000000000000000000001";
const FUNDER = "GFUNDER000000000000000000000000000000000000000000000000001";
const DUE_DATE = Math.floor(Date.now() / 1000) + 30 * 24 * 3600; // 30 days from now

function makeEvent(overrides: Partial<InvoiceEvent> = {}): InvoiceEvent {
  return {
    eventId: "evt-template-001",
    type: "funded",
    invoiceId: 42,
    freelancer: FREELANCER,
    payer: PAYER,
    funder: FUNDER,
    amount: "1000000000", // 100 XLM in stroops
    dueDate: DUE_DATE,
    discountRate: 300,
    ...overrides,
  };
}

// ─── Helper assertions ────────────────────────────────────────────────────────

/** Verify the HTML contains valid outer structure. */
function assertValidHtml(html: string) {
  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain("<html");
  expect(html).toContain("</html>");
  expect(html).toContain("<body");
  expect(html).toContain("</body>");
}

/** Verify no obviously broken self-closing tags or unclosed attribute quotes. */
function assertNoObviousHtmlErrors(html: string) {
  // Unclosed double quotes in attributes would appear as =" followed by > without a closing "
  // We do a basic sanity check — not a full HTML parser, but catches common template bugs.
  const unclosedAttr = /=\s*"[^"]*\n/.test(html);
  expect(unclosedAttr).toBe(false);
}

// ─── Funding template ─────────────────────────────────────────────────────────

describe("renderFundedEmail", () => {
  it("renders a complete HTML email for a freelancer", () => {
    const html = renderFundedEmail({ event: makeEvent(), recipientRole: "freelancer" });

    assertValidHtml(html);
    assertNoObviousHtmlErrors(html);
    expect(html).toContain("Invoice Funded");
    expect(html).toContain("Invoice #42");
    expect(html).toContain("Funded");
  });

  it("renders a complete HTML email for a payer", () => {
    const html = renderFundedEmail({ event: makeEvent(), recipientRole: "payer" });

    assertValidHtml(html);
    expect(html).toContain("Invoice #42");
    expect(html).toContain("Funded");
  });

  it("interpolates the invoice amount (100 XLM)", () => {
    const html = renderFundedEmail({ event: makeEvent(), recipientRole: "freelancer" });
    expect(html).toContain("100"); // 1000000000 stroops = 100 XLM
  });

  it("interpolates freelancer and payer addresses", () => {
    const html = renderFundedEmail({ event: makeEvent(), recipientRole: "freelancer" });
    // shortAddress clips to first 6 + last 6 chars
    expect(html).toContain("GFREEL");
    expect(html).toContain("GPAYER");
  });

  it("interpolates funder address when funder is present", () => {
    const html = renderFundedEmail({
      event: makeEvent({ funder: FUNDER }),
      recipientRole: "freelancer",
    });
    expect(html).toContain("GFUNDE");
  });

  it("uses custom dashboardUrl when provided", () => {
    const html = renderFundedEmail({
      event: makeEvent(),
      recipientRole: "freelancer",
      dashboardUrl: "https://custom.example.com/invoices/42",
    });
    expect(html).toContain("https://custom.example.com/invoices/42");
  });

  it("falls back to default dashboard URL when not provided", () => {
    const html = renderFundedEmail({ event: makeEvent(), recipientRole: "freelancer" });
    expect(html).toContain("https://iln.finance/invoices/42");
  });

  it("escapes HTML special characters in dynamic content", () => {
    const event = makeEvent();
    // Override with XSS payload in freelancer field (should be escaped)
    (event as any).freelancer = '<script>alert("xss")</script>';
    const html = renderFundedEmail({ event, recipientRole: "freelancer" });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;scrip");
    expect(html).toContain("cript&gt;");
  });
});

describe("buildFundedSubject", () => {
  it("includes the invoice ID and action word", () => {
    const subject = buildFundedSubject(makeEvent());
    expect(subject).toContain("42");
    expect(subject.toLowerCase()).toContain("fund");
  });
});

// ─── Payment template ─────────────────────────────────────────────────────────

describe("renderPaymentEmail", () => {
  it("renders a complete HTML email for a freelancer", () => {
    const html = renderPaymentEmail({
      event: makeEvent({ type: "paid" }),
      recipientRole: "freelancer",
    });

    assertValidHtml(html);
    assertNoObviousHtmlErrors(html);
    expect(html).toContain("Invoice #42");
    expect(html).toContain("Paid");
  });

  it("renders a complete HTML email for an LP (funder)", () => {
    const html = renderPaymentEmail({
      event: makeEvent({ type: "paid" }),
      recipientRole: "lp",
    });

    assertValidHtml(html);
    expect(html).toContain("Liquidity Provider");
    expect(html).toContain("Invoice #42");
  });

  it("interpolates the invoice amount", () => {
    const html = renderPaymentEmail({
      event: makeEvent({ type: "paid", amount: "500000000" }), // 50 XLM
      recipientRole: "freelancer",
    });
    expect(html).toContain("50");
  });

  it("shows funder row when funder is present", () => {
    const html = renderPaymentEmail({
      event: makeEvent({ type: "paid", funder: FUNDER }),
      recipientRole: "lp",
    });
    expect(html).toContain("GFUNDE");
  });

  it("omits funder row when funder is null", () => {
    const html = renderPaymentEmail({
      event: makeEvent({ type: "paid", funder: null }),
      recipientRole: "freelancer",
    });
    expect(html).not.toContain("Funded By");
  });

  it("uses custom dashboardUrl when provided", () => {
    const html = renderPaymentEmail({
      event: makeEvent({ type: "paid" }),
      recipientRole: "freelancer",
      dashboardUrl: "https://custom.example.com/invoices/42",
    });
    expect(html).toContain("https://custom.example.com/invoices/42");
  });
});

describe("buildPaymentSubject", () => {
  it("includes the invoice ID and settlement keyword", () => {
    const subject = buildPaymentSubject(makeEvent({ type: "paid" }));
    expect(subject).toContain("42");
    expect(subject.toLowerCase()).toMatch(/settled|paid|payment/);
  });
});

// ─── Dispute / Default template ───────────────────────────────────────────────

describe("renderDisputeEmail", () => {
  it("renders a complete HTML email for a freelancer", () => {
    const html = renderDisputeEmail({
      event: makeEvent({ type: "defaulted" }),
      recipientRole: "freelancer",
    });

    assertValidHtml(html);
    assertNoObviousHtmlErrors(html);
    expect(html).toContain("Invoice #42");
    expect(html).toContain("Defaulted");
  });

  it("renders a complete HTML email for an LP", () => {
    const html = renderDisputeEmail({
      event: makeEvent({ type: "defaulted" }),
      recipientRole: "lp",
    });

    assertValidHtml(html);
    expect(html).toContain("Liquidity Provider");
  });

  it("mentions recovery process for LP", () => {
    const html = renderDisputeEmail({
      event: makeEvent({ type: "defaulted" }),
      recipientRole: "lp",
    });
    expect(html.toLowerCase()).toMatch(/recovery|insurance/);
  });

  it("mentions insurance pool for freelancer", () => {
    const html = renderDisputeEmail({
      event: makeEvent({ type: "defaulted" }),
      recipientRole: "freelancer",
    });
    expect(html.toLowerCase()).toMatch(/insurance|exposure/);
  });

  it("includes support email link", () => {
    const html = renderDisputeEmail({
      event: makeEvent({ type: "defaulted" }),
      recipientRole: "freelancer",
    });
    expect(html).toContain("support@iln.finance");
  });

  it("omits funder row when invoice was never funded", () => {
    const html = renderDisputeEmail({
      event: makeEvent({ type: "defaulted", funder: undefined }),
      recipientRole: "freelancer",
    });
    expect(html).not.toContain("Funded By");
  });
});

describe("buildDisputeSubject", () => {
  it("includes the invoice ID and defaulted keyword", () => {
    const subject = buildDisputeSubject(makeEvent({ type: "defaulted" }));
    expect(subject).toContain("42");
    expect(subject.toLowerCase()).toContain("default");
  });
});

// ─── Due-date warning template ────────────────────────────────────────────────

describe("renderDueWarningEmail", () => {
  it("renders a complete HTML email", () => {
    const html = renderDueWarningEmail({ event: makeEvent({ type: "due_date_warning" }) });

    assertValidHtml(html);
    assertNoObviousHtmlErrors(html);
    expect(html).toContain("Invoice #42");
    expect(html).toContain("48 hours");
  });

  it("interpolates due date", () => {
    const html = renderDueWarningEmail({ event: makeEvent({ type: "due_date_warning" }) });
    // formatDate produces a UTC string — just check a year appears
    expect(html).toMatch(/202\d/);
  });

  it("interpolates the invoice amount", () => {
    const html = renderDueWarningEmail({
      event: makeEvent({ type: "due_date_warning", amount: "2500000000" }), // 250 XLM
    });
    expect(html).toContain("250");
  });

  it("mentions default consequences", () => {
    const html = renderDueWarningEmail({ event: makeEvent({ type: "due_date_warning" }) });
    expect(html.toLowerCase()).toMatch(/default|reputation/);
  });

  it("uses custom dashboardUrl when provided", () => {
    const html = renderDueWarningEmail({
      event: makeEvent({ type: "due_date_warning" }),
      dashboardUrl: "https://custom.example.com/invoices/42",
    });
    expect(html).toContain("https://custom.example.com/invoices/42");
  });
});

describe("buildDueWarningSubject", () => {
  it("includes the invoice ID and 48-hours keyword", () => {
    const subject = buildDueWarningSubject(makeEvent({ type: "due_date_warning" }));
    expect(subject).toContain("42");
    expect(subject).toContain("48");
  });
});

// ─── HTML shell ───────────────────────────────────────────────────────────────

describe("emailShell / shared footer", () => {
  it("every template includes the ILN footer with unsubscribe link", () => {
    const templates = [
      renderFundedEmail({ event: makeEvent(), recipientRole: "freelancer" }),
      renderPaymentEmail({ event: makeEvent({ type: "paid" }), recipientRole: "freelancer" }),
      renderDisputeEmail({ event: makeEvent({ type: "defaulted" }), recipientRole: "freelancer" }),
      renderDueWarningEmail({ event: makeEvent({ type: "due_date_warning" }) }),
    ];

    for (const html of templates) {
      expect(html).toContain("Invoice Liquidity Network");
      expect(html).toContain("Unsubscribe");
    }
  });

  it("every template includes responsive viewport meta tag", () => {
    const html = renderFundedEmail({ event: makeEvent(), recipientRole: "freelancer" });
    expect(html).toContain('name="viewport"');
  });
});

// ─── Snapshot / compatibility coverage (#577) ────────────────────────────────

function renderSmsTemplate(event: InvoiceEvent): string {
  return [
    buildFundedSubject(event),
    `Invoice #${event.invoiceId}`,
    `Status: ${event.type}`,
    `Amount: ${event.amount}`,
    `Due: ${new Date(event.dueDate * 1000).toISOString()}`,
  ].join("\n");
}

function renderSnapshotBundle() {
  const event = makeEvent({ dueDate: 1893456000 });
  return {
    fundedEmail: renderFundedEmail({ event, recipientRole: "freelancer" }),
    paymentEmail: renderPaymentEmail({ event: makeEvent({ ...event, type: "paid" }), recipientRole: "lp" }),
    disputeEmail: renderDisputeEmail({ event: makeEvent({ ...event, type: "defaulted" }), recipientRole: "lp" }),
    dueWarningEmail: renderDueWarningEmail({ event: makeEvent({ ...event, type: "due_date_warning" }) }),
    sms: renderSmsTemplate(event),
  };
}

describe("notification template snapshots (#577)", () => {
  it("captures email and SMS templates", () => {
    expect(renderSnapshotBundle()).toMatchSnapshot();
  });

  it("interpolates variables and escapes dynamic HTML values", () => {
    const event = makeEvent({
      invoiceId: 777,
      amount: "700000000",
      freelancer: 'GFREELANCER"><script>alert(1)</script>',
      payer: "GPAYER&<>",
      funder: "GFUNDER&<>",
    });

    const html = renderFundedEmail({ event, recipientRole: "freelancer" });
    const sms = renderSmsTemplate(event);

    expect(html).toContain("Invoice #777");
    expect(html).toContain("70 XLM");
    expect(html).toContain("GFREEL");
    expect(html).toContain("GPAYER");
    expect(html).toContain("GFUNDE");
    expect(html).not.toContain("<script>");
    expect(html).toContain("cript&gt;");
    expect(html).toContain("&amp;");

    expect(sms).toContain("Invoice #777");
    expect(sms).toContain("Status: funded");
    expect(sms).toContain("Amount: 700000000");
  });

  it("tests responsive email CSS", () => {
    const html = renderFundedEmail({ event: makeEvent(), recipientRole: "freelancer" });

    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1.0"');
    expect(html).toContain("@media only screen and (max-width: 620px)");
    expect(html).toContain(".header, .body-content, .footer { padding: 20px; }");
    expect(html).toContain("max-width: 600px");
  });

  it("uses cross-client-safe email markup", () => {
    const html = renderPaymentEmail({ event: makeEvent({ type: "paid" }), recipientRole: "freelancer" });

    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("mso-table-lspace: 0pt");
    expect(html).toContain("<table>");
    expect(html).not.toMatch(/display:\s*(flex|grid)/i);
    expect(html).not.toMatch(/position:\s*(fixed|sticky)/i);
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/var\(--/);
  });

  it("passes static accessibility checks", () => {
    const html = renderDisputeEmail({ event: makeEvent({ type: "defaulted" }), recipientRole: "lp" });
    const images = html.match(/<img\b[^>]*>/g) ?? [];

    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Invoice #42 Defaulted</title>");
    expect(html).toMatch(/<h1[^>]*>Invoice Defaulted<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>Invoice #42 has defaulted\.<\/h2>/);
    expect(html).toMatch(/color:\s*#[0-9a-f]{6}/i);
    expect(html).toMatch(/background-color:\s*#[0-9a-f]{6}/i);
    expect(images.every((image) => /\salt=/.test(image))).toBe(true);
  });

  it("escapes shared shell title and body content", () => {
    const html = emailShell('Invoice <42> & "ready"', `<p>${escapeHtml("<script>alert(1)</script>")}</p>`);

    expect(html).toContain("Invoice &lt;42&gt; &amp; &quot;ready&quot;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
});
