process.env.NOTIFICATIONS_RPC_URL = "http://localhost:8000";
process.env.NOTIFICATIONS_CONTRACT_ID = "GTESTCONTRACT";
process.env.NOTIFICATIONS_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
process.env.RESEND_API_KEY = "test-api-key";

import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { createDb, setDb, createSubscription, upsertInvoice } from "../db";
import * as rpc from "../rpc";
import * as delivery from "../delivery";
import { processEvent, processScheduledNotifications } from "../processor";

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = createDb(":memory:");
  setDb(db);
  vi.restoreAllMocks();
});

describe("Notification processor", () => {
  it("sends invoice funded notifications for freelancer and payer", async () => {
    const invoice = {
      id: 1,
      freelancer: "GAFREELANCER",
      payer: "GAPAYER",
      amount: "10000000",
      due_date: Math.floor(Date.now() / 1000) + 86400,
      discount_rate: 300,
      status: "Funded" as const,
      funder: "GLP",
      funded_at: Math.floor(Date.now() / 1000),
    };

    vi.spyOn(rpc, "fetchInvoice").mockResolvedValue(invoice as any);
    const deliverySpy = vi
      .spyOn(delivery, "deliverNotification")
      .mockResolvedValue();

    createSubscription({
      stellar_address: invoice.freelancer,
      channel: "email",
      destination: "freelancer@example.com",
      triggers: ["invoice_funded"],
    });
    createSubscription({
      stellar_address: invoice.payer,
      channel: "webhook",
      destination: "https://example.com/payer",
      triggers: ["invoice_funded"],
    });

    const event = {
      id: "evt-1",
      topic: [nativeToScVal("funded")],
      value: nativeToScVal(BigInt(invoice.id)),
      ledger: 1,
      ledgerClosedAt: new Date().toISOString(),
    } as any;

    await processEvent(event);

    expect(deliverySpy).toHaveBeenCalledTimes(2);
    expect(deliverySpy.mock.calls[0][0].destination).toBe("freelancer@example.com");
    expect(deliverySpy.mock.calls[1][0].destination).toBe("https://example.com/payer");
  });

  it("sends invoice submitted notifications for freelancer and payer", async () => {
    const invoice = {
      id: 10,
      freelancer: "GAFREELANCER",
      payer: "GAPAYER",
      amount: "10000000",
      due_date: Math.floor(Date.now() / 1000) + 86400,
      discount_rate: 300,
      status: "Pending" as const,
      funder: null,
      funded_at: null,
    };

    vi.spyOn(rpc, "fetchInvoice").mockResolvedValue(invoice as any);
    const deliverySpy = vi
      .spyOn(delivery, "deliverNotification")
      .mockResolvedValue();

    createSubscription({
      stellar_address: invoice.freelancer,
      channel: "email",
      destination: "freelancer@example.com",
      triggers: ["invoice_submitted"],
    });
    createSubscription({
      stellar_address: invoice.payer,
      channel: "webhook",
      destination: "https://example.com/payer",
      triggers: ["invoice_submitted"],
    });

    const event = {
      id: "evt-10",
      topic: [nativeToScVal("submitted")],
      value: nativeToScVal(BigInt(invoice.id)),
      ledger: 1,
      ledgerClosedAt: new Date().toISOString(),
    } as any;

    await processEvent(event);

    expect(deliverySpy).toHaveBeenCalledTimes(2);
    expect(deliverySpy.mock.calls[0][0].destination).toBe("freelancer@example.com");
    expect(deliverySpy.mock.calls[1][0].destination).toBe("https://example.com/payer");
  });

  it("sends invoice disputed notifications for freelancer and LP", async () => {
    const invoice = {
      id: 11,
      freelancer: "GAFREELANCER",
      payer: "GAPAYER",
      amount: "10000000",
      due_date: Math.floor(Date.now() / 1000) + 86400,
      discount_rate: 300,
      status: "Disputed" as const,
      funder: "GLP",
      funded_at: Math.floor(Date.now() / 1000),
    };

    vi.spyOn(rpc, "fetchInvoice").mockResolvedValue(invoice as any);
    const deliverySpy = vi
      .spyOn(delivery, "deliverNotification")
      .mockResolvedValue();

    createSubscription({
      stellar_address: invoice.freelancer,
      channel: "email",
      destination: "freelancer@example.com",
      triggers: ["invoice_disputed"],
    });
    createSubscription({
      stellar_address: "GLP",
      channel: "webhook",
      destination: "https://example.com/lp",
      triggers: ["invoice_disputed"],
    });

    const event = {
      id: "evt-11",
      topic: [nativeToScVal("disputed")],
      value: nativeToScVal(BigInt(invoice.id)),
      ledger: 1,
      ledgerClosedAt: new Date().toISOString(),
    } as any;

    await processEvent(event);

    expect(deliverySpy).toHaveBeenCalledTimes(2);
    expect(deliverySpy.mock.calls[0][0].destination).toBe("freelancer@example.com");
    expect(deliverySpy.mock.calls[1][0].destination).toBe("https://example.com/lp");
  });

  it("sends due soon warning to the LP once", async () => {
    const now = Math.floor(Date.now() / 1000);
    upsertInvoice({
      id: 2,
      freelancer: "GAFREELANCER",
      payer: "GAPAYER",
      amount: "5000000",
      due_date: now + 47 * 3600,
      discount_rate: 200,
      status: "Funded",
      funder: "GLP",
      funded_at: now - 3600,
    });

    createSubscription({
      stellar_address: "GLP",
      channel: "webhook",
      destination: "https://example.com/lp",
      triggers: ["invoice_due_soon"],
    });

    const deliverySpy = vi
      .spyOn(delivery, "deliverNotification")
      .mockResolvedValue();

    await processScheduledNotifications();
    await processScheduledNotifications();

    expect(deliverySpy).toHaveBeenCalledTimes(1);
  });

  it("sends overdue warning to the payer once", async () => {
    const now = Math.floor(Date.now() / 1000);
    upsertInvoice({
      id: 3,
      freelancer: "GAFREELANCER",
      payer: "GAPAYER",
      amount: "5000000",
      due_date: now - 3600,
      discount_rate: 200,
      status: "Funded",
      funder: "GLP",
      funded_at: now - 86400,
    });

    createSubscription({
      stellar_address: "GAPAYER",
      channel: "email",
      destination: "payer@example.com",
      triggers: ["invoice_overdue"],
    });

    const deliverySpy = vi
      .spyOn(delivery, "deliverNotification")
      .mockResolvedValue();

    await processScheduledNotifications();
    await processScheduledNotifications();

    expect(deliverySpy).toHaveBeenCalledTimes(1);
  });
});
