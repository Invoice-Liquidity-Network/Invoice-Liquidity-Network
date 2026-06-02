import pc from "picocolors";

import { formatAmount } from "./amounts";
import { formatTimestamp } from "./dates";
import type { Invoice, ListedInvoice, ProtocolConfig, ResolvedConfig } from "./types";

export interface Ui {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
}

export function createUi(stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): Ui {
  return {
    error(message: string) {
      stderr.write(`${pc.red("error")} ${message}\n`);
    },
    info(message: string) {
      stdout.write(`${message}\n`);
    },
    success(message: string) {
      stdout.write(`${pc.green("success")} ${message}\n`);
    },
    warn(message: string) {
      stderr.write(`${pc.yellow("warn")} ${message}\n`);
    },
  };
}

export function describeConfig(config: ResolvedConfig): string {
  return `${config.network} | ${config.rpcUrl} | ${config.contractId}`;
}

export function formatInvoiceDetails(invoice: Invoice): string {
  const lines = [
    row("Invoice", invoice.id.toString()),
    row("Status", invoice.status),
    row("Amount", formatAmount(invoice.amount)),
    row("Funded", formatAmount(invoice.amountFunded)),
    row("Remaining", formatAmount(invoice.amount - invoice.amountFunded)),
    row("Rate", `${invoice.discountRate} bps`),
    row("Due", formatTimestamp(invoice.dueDate)),
    row("Freelancer", invoice.freelancer),
    row("Payer", invoice.payer),
    row("Funder", invoice.funder ?? "-"),
    row("Token", invoice.token),
    row("Funded At", invoice.fundedAt == null ? "-" : formatTimestamp(invoice.fundedAt)),
  ];

  return lines.join("\n");
}

export function formatInvoiceList(invoices: ListedInvoice[]): string {
  if (invoices.length === 0) {
    return "No invoices found for that address.";
  }

  const headers = ["ID", "Role", "Status", "Amount", "Due"];
  const rows = invoices.map((invoice) => [
    invoice.id.toString(),
    invoice.role,
    invoice.status,
    formatAmount(invoice.amount),
    formatTimestamp(invoice.dueDate).slice(0, 10),
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );

  const renderRow = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");

  return [pc.bold(renderRow(headers)), ...rows.map(renderRow)].join("\n");
}

export function formatProtocolConfig(config: ProtocolConfig): string {
  const lines = [
    row("Min Amount", config.minInvoiceAmount.toString()),
    row("Max Rate", `${config.maxDiscountRate} bps`),
    row("Fee", `${config.protocolFeeBps} bps`),
    row("Reputation", config.minPayerReputation.toString()),
    row("Decay", `${config.decayRateBps} bps`),
    config.minInvoiceDuration == null
      ? null
      : row("Min Duration", `${config.minInvoiceDuration}s`),
    config.maxInvoiceDuration == null
      ? null
      : row("Max Duration", `${config.maxInvoiceDuration}s`),
    config.gracePeriodSeconds == null
      ? null
      : row("Grace", `${config.gracePeriodSeconds}s`),
  ];

  return lines.filter((line): line is string => line !== null).join("\n");
}

function row(label: string, value: string): string {
  return `${pc.bold(label.padEnd(11))} ${value}`;
}
