import pc from 'picocolors';

import { formatAmount } from './amounts';
import { formatTimestamp } from './dates';
import type { Invoice, ListedInvoice, ProtocolConfig, ResolvedConfig } from './types';

export interface Ui {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
}

export function createUi(stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): Ui {
  return {
    error(message: string) {
      stderr.write(`${pc.red('error')} ${message}\n`);
    },
    info(message: string) {
      stdout.write(`${message}\n`);
    },
    success(message: string) {
      stdout.write(`${pc.green('success')} ${message}\n`);
    },
    warn(message: string) {
      stderr.write(`${pc.yellow('warn')} ${message}\n`);
    },
  };
}

export function describeConfig(config: ResolvedConfig): string {
  return `${config.network} | ${config.rpcUrl} | ${config.contractId}`;
}

function formatStatus(status: string): string {
  switch (status) {
    case 'Pending':
      return pc.yellow(status);
    case 'Funded':
      return pc.cyan(status);
    case 'Paid':
      return pc.green(status);
    case 'Defaulted':
      return pc.red(status);
    default:
      return status;
  }
}

export function formatJsonSuccess(data: any): string {
  return JSON.stringify({ success: true, data }, null, 2);
}

export function formatJsonError(error: string): string {
  return JSON.stringify({ success: false, error }, null, 2);
}

export function formatInvoiceDetailsJson(invoice: Invoice): string {
  return JSON.stringify(
    {
      id: invoice.id.toString(),
      status: invoice.status,
      amount: invoice.amount.toString(),
      amountFunded: invoice.amountFunded.toString(),
      remaining: (invoice.amount - invoice.amountFunded).toString(),
      discountRate: invoice.discountRate,
      dueDate: invoice.dueDate,
      freelancer: invoice.freelancer,
      payer: invoice.payer,
      funder: invoice.funder ?? null,
      token: invoice.token,
      fundedAt: invoice.fundedAt ?? null,
    },
    null,
    2
  );
}

export function formatInvoiceListJson(invoices: ListedInvoice[]): string {
  return JSON.stringify(
    invoices.map((inv) => ({
      id: inv.id.toString(),
      role: inv.role,
      status: inv.status,
      amount: inv.amount.toString(),
      dueDate: inv.dueDate,
      freelancer: inv.freelancer,
      payer: inv.payer,
      funder: inv.funder ?? null,
      fundedAt: inv.fundedAt ?? null,
    })),
    null,
    2
  );
}

export function formatInvoiceDetails(invoice: Invoice): string {
  const lines = [
    row('Invoice', invoice.id.toString()),
    row('Status', formatStatus(invoice.status)),
    row('Amount', formatAmount(invoice.amount)),
    row('Funded', formatAmount(invoice.amountFunded)),
    row('Remaining', formatAmount(invoice.amount - invoice.amountFunded)),
    row('Rate', `${invoice.discountRate} bps`),
    row('Due', formatTimestamp(invoice.dueDate)),
    row('Freelancer', invoice.freelancer),
    row('Payer', invoice.payer),
    row('Funder', invoice.funder ?? '-'),
    row('Token', invoice.token),
    row(
      'Funded At',
      invoice.fundedAt === null || invoice.fundedAt === undefined
        ? '-'
        : formatTimestamp(invoice.fundedAt)
    ),
  ];

  return lines.join('\n');
}

const STATUS_COL = 2;

export function formatInvoiceList(invoices: ListedInvoice[]): string {
  if (invoices.length === 0) {
    return 'No invoices found for that address.';
  }

  const headers = ['ID', 'Role', 'Status', 'Amount', 'Due'];
  const rows = invoices.map((invoice) => [
    invoice.id.toString(),
    invoice.role,
    invoice.status,
    formatAmount(invoice.amount),
    formatTimestamp(invoice.dueDate).slice(0, 10),
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length))
  );

  const separator = widths.map((w) => '-'.repeat(w)).join('  ');

  const renderRow = (cells: string[]) =>
    cells
      .map((cell, index) => {
        const padded = cell.padEnd(widths[index]);
        return index === STATUS_COL ? formatStatus(padded) : padded;
      })
      .join('  ');

  return [pc.bold(renderRow(headers)), separator, ...rows.map(renderRow)].join('\n');
}

export function formatProtocolConfig(config: ProtocolConfig): string {
  const lines = [
    row('Min Amount', config.minInvoiceAmount.toString()),
    row('Max Rate', `${config.maxDiscountRate} bps`),
    row('Fee', `${config.protocolFeeBps} bps`),
    row('Reputation', config.minPayerReputation.toString()),
    row('Decay', `${config.decayRateBps} bps`),
    config.minInvoiceDuration === null || config.minInvoiceDuration === undefined
      ? null
      : row('Min Duration', `${config.minInvoiceDuration}s`),
    config.maxInvoiceDuration === null || config.maxInvoiceDuration === undefined
      ? null
      : row('Max Duration', `${config.maxInvoiceDuration}s`),
    config.gracePeriodSeconds === null || config.gracePeriodSeconds === undefined
      ? null
      : row('Grace', `${config.gracePeriodSeconds}s`),
  ];

  return lines.filter((line): line is string => line !== null).join('\n');
}

export function formatProtocolConfigJson(config: ProtocolConfig): string {
  return JSON.stringify(
    {
      minInvoiceAmount: config.minInvoiceAmount.toString(),
      maxDiscountRate: config.maxDiscountRate,
      protocolFeeBps: config.protocolFeeBps,
      minPayerReputation: config.minPayerReputation,
      decayRateBps: config.decayRateBps,
      minInvoiceDuration: config.minInvoiceDuration ?? null,
      maxInvoiceDuration: config.maxInvoiceDuration ?? null,
      gracePeriodSeconds: config.gracePeriodSeconds ?? null,
    },
    null,
    2
  );
}

const ACTION_LABEL: Record<string, string> = {
  freelancer: 'submit',
  payer: 'pay',
  funder: 'fund',
};

export function formatHistoryTable(invoices: ListedInvoice[]): string {
  if (invoices.length === 0) {
    return 'No history found.';
  }

  const headers = ['ID', 'Action', 'Status', 'Amount', 'Due'];
  const rows = invoices.map((invoice) => [
    invoice.id.toString(),
    ACTION_LABEL[invoice.role] ?? invoice.role,
    invoice.status,
    formatAmount(invoice.amount),
    formatTimestamp(invoice.dueDate).slice(0, 10),
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length))
  );

  const separator = widths.map((w) => '-'.repeat(w)).join('  ');

  const renderRow = (cells: string[]) =>
    cells
      .map((cell, index) => {
        const padded = cell.padEnd(widths[index]);
        return index === STATUS_COL ? formatStatus(padded) : padded;
      })
      .join('  ');

  return [pc.bold(renderRow(headers)), separator, ...rows.map(renderRow)].join('\n');
}

export function formatHistoryJson(invoices: ListedInvoice[]): string {
  return JSON.stringify(
    invoices.map((inv) => ({
      id: inv.id.toString(),
      action: ACTION_LABEL[inv.role] ?? inv.role,
      status: inv.status,
      amount: inv.amount.toString(),
      dueDate: inv.dueDate,
      freelancer: inv.freelancer,
      payer: inv.payer,
      funder: inv.funder ?? null,
      fundedAt: inv.fundedAt ?? null,
    })),
    null,
    2
  );
}

function row(label: string, value: string): string {
  return `${pc.bold(label.padEnd(11))} ${value}`;
}

export function helpSection(title: string): string {
  return pc.bold(title);
}

export function helpExample(text: string): string {
  return `  ${pc.dim(text)}`;
}
