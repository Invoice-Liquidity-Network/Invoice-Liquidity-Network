export interface CsvInvoiceRow {
  payer: string;
  amount: bigint;
  dueDate: number;
  discountRate: number;
  token?: string;
}

export interface CsvValidationError {
  row: number;
  field: string;
  message: string;
  value: string;
}

const REQUIRED_COLUMNS = ["payer", "amount", "due_date", "discount_rate"];
const OPTIONAL_COLUMNS = ["token"];

export function parseCsvHeader(line: string): string[] {
  return line
    .split(",")
    .map((col) => col.trim().toLowerCase().replace(/['"]/g, ""));
}

export function validateCsvHeaders(headers: string[]): CsvValidationError[] {
  const errors: CsvValidationError[] = [];
  for (const required of REQUIRED_COLUMNS) {
    if (!headers.includes(required)) {
      errors.push({
        row: 0,
        field: required,
        message: `Missing required column: "${required}"`,
        value: headers.join(", "),
      });
    }
  }
  return errors;
}

export function parseCsvRow(
  row: string[],
  headers: string[],
  index: number,
): { row: CsvInvoiceRow; errors: CsvValidationError[] } {
  const errors: CsvValidationError[] = [];
  const data: Record<string, string> = {};

  for (let i = 0; i < headers.length; i++) {
    data[headers[i]] = (row[i] ?? "").trim().replace(/['"]/g, "");
  }

  const payer = data.payer ?? "";
  if (!payer.startsWith("G") || payer.length < 10) {
    errors.push({
      row: index + 1,
      field: "payer",
      message: "Invalid Stellar address",
      value: payer,
    });
  }

  let amount: bigint;
  try {
    const parsed = parseFloat(data.amount ?? "");
    if (isNaN(parsed) || parsed <= 0) throw new Error();
    amount = BigInt(Math.round(parsed * 10_000_000));
  } catch {
    amount = 0n;
    errors.push({
      row: index + 1,
      field: "amount",
      message: "Invalid amount (must be a positive number)",
      value: data.amount ?? "",
    });
  }

  let dueDate: number;
  try {
    dueDate = parseInt(data.due_date ?? "", 10);
    if (isNaN(dueDate) || dueDate <= 0) throw new Error();
  } catch {
    dueDate = 0;
    errors.push({
      row: index + 1,
      field: "due_date",
      message: "Invalid due_date (must be a Unix timestamp in seconds)",
      value: data.due_date ?? "",
    });
  }

  let discountRate: number;
  try {
    discountRate = parseInt(data.discount_rate ?? "", 10);
    if (isNaN(discountRate) || discountRate < 0 || discountRate > 10000) throw new Error();
  } catch {
    discountRate = 0;
    errors.push({
      row: index + 1,
      field: "discount_rate",
      message: "Invalid discount_rate (must be 0-10000 bps)",
      value: data.discount_rate ?? "",
    });
  }

  const token = data.token || undefined;

  return {
    row: { payer, amount, dueDate, discountRate, token },
    errors,
  };
}

export function parseCsv(
  content: string,
): { rows: CsvInvoiceRow[]; errors: CsvValidationError[] } {
  const errors: CsvValidationError[] = [];
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    errors.push({
      row: 0,
      field: "file",
      message: "CSV must have a header row and at least one data row",
      value: "",
    });
    return { rows: [], errors };
  }

  const headers = parseCsvHeader(lines[0]);
  const headerErrors = validateCsvHeaders(headers);
  errors.push(...headerErrors);
  if (headerErrors.length > 0) {
    return { rows: [], errors };
  }

  const rows: CsvInvoiceRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const parsed = parseCsvRow(values, headers, i - 1);
    errors.push(...parsed.errors);
    if (parsed.errors.length === 0) {
      rows.push(parsed.row);
    }
  }

  return { rows, errors };
}

export function formatBatchErrorSummary(
  results: Array<{ index: number; success: boolean; error?: string }>,
): string[] {
  const byReason = new Map<string, number[]>();
  for (const r of results) {
    if (!r.success && r.error) {
      const existing = byReason.get(r.error) ?? [];
      existing.push(r.index);
      byReason.set(r.error, existing);
    }
  }
  const summaries: string[] = [];
  for (const [reason, indices] of byReason) {
    summaries.push(
      `${indices.length} invoice(s) (rows ${indices.map((i) => i + 1).join(", ")}) failed: ${reason}`,
    );
  }
  return summaries;
}
