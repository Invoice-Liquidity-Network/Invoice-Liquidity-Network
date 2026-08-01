#!/usr/bin/env node
/**
 * scripts/generate-shared-types.mts
 *
 * Automated TypeScript type generator for packages/shared/src/types.ts.
 *
 * PURPOSE
 * ───────
 * Soroban contracts expose a machine-readable spec via:
 *
 *   stellar contract info --wasm <wasm-file> --output-format json > spec.json
 *
 * This script reads that spec and generates the complete types.ts file,
 * eliminating the hand-maintained parallel definitions that caused the drift
 * documented in docs/contracts/README.md.
 *
 * USAGE
 * ─────
 * # From repo root — generate from a pre-existing spec file:
 *   node --import tsx/esm scripts/generate-shared-types.mts \
 *     --spec backend/target/spec.json \
 *     --out packages/shared/src/types.ts
 *
 * # Generate fresh spec from WASM and then generate types:
 *   stellar contract build   # in backend/
 *   stellar contract info \
 *     --wasm backend/target/wasm32v1-none/release/*.wasm \
 *     --output-format json > backend/target/spec.json
 *   node --import tsx/esm scripts/generate-shared-types.mts \
 *     --spec backend/target/spec.json \
 *     --out packages/shared/src/types.ts
 *
 * # Dry-run (print to stdout, do not write):
 *   node --import tsx/esm scripts/generate-shared-types.mts \
 *     --spec backend/target/spec.json \
 *     --dry-run
 *
 * CI INTEGRATION
 * ──────────────
 * The sdk-types-sync job in ci.yml already runs `pnpm generate:types` and
 * diffs sdk/src/generated/types.ts. Add a parallel step for shared types:
 *
 *   - name: Regenerate shared types
 *     run: pnpm generate:shared-types
 *
 *   - name: Check if shared types changed
 *     run: |
 *       if ! git diff --exit-code packages/shared/src/types.ts; then
 *         echo "❌ Shared types are out of sync! Run: pnpm generate:shared-types"
 *         exit 1
 *       fi
 *
 * Add to root package.json scripts:
 *   "generate:shared-types": "node --import tsx/esm scripts/generate-shared-types.mts --spec backend/target/spec.json --out packages/shared/src/types.ts"
 *
 * SOROBAN TYPE → TYPESCRIPT MAPPING
 * ──────────────────────────────────
 * | Soroban / XDR type  | TypeScript type       | Notes                          |
 * |---------------------|-----------------------|--------------------------------|
 * | u32                 | number                | Safe up to 2^32-1              |
 * | u64                 | bigint                | Exceeds Number.MAX_SAFE_INTEGER|
 * | i128                | bigint                | Signed 128-bit                 |
 * | bool                | boolean               |                                |
 * | Address             | string                | Stellar G... or C... address   |
 * | BytesN<32>          | Uint8Array            | Fixed-length byte array        |
 * | Option<T>           | T | null              |                                |
 * | Vec<T>              | T[]                   |                                |
 * | Symbol / String     | string                |                                |
 * | enum (unit)         | string literal union  |                                |
 * | struct              | interface             |                                |
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const specPath = getArg("--spec");
const outPath = getArg("--out");
const dryRun = args.includes("--dry-run");

if (!specPath) {
  console.error("Usage: generate-shared-types.mts --spec <path> [--out <path>] [--dry-run]");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// ─── Soroban spec types (subset we care about) ───────────────────────────────

interface SorobanSpecEntry {
  type: "FunctionV0" | "UdtStructV0" | "UdtUnionV0" | "UdtEnumV0" | "UdtErrorEnumV0";
  name?: string;
  fields?: SorobanSpecField[];
  cases?: SorobanSpecCase[];
  doc?: string;
}

interface SorobanSpecField {
  name: string;
  type: SorobanType;
  doc?: string;
}

interface SorobanSpecCase {
  name: string;
  type?: "Unit" | "Tuple";
  fields?: SorobanSpecField[];
  value?: number;
  doc?: string;
}

type SorobanType =
  | { type: "U32" }
  | { type: "U64" }
  | { type: "I128" }
  | { type: "Bool" }
  | { type: "Address" }
  | { type: "Bytes"; length?: number }
  | { type: "BytesN"; n: number }
  | { type: "String" }
  | { type: "Symbol" }
  | { type: "Option"; value: SorobanType }
  | { type: "Vec"; element: SorobanType }
  | { type: "Map"; key: SorobanType; value: SorobanType }
  | { type: "Custom"; name: string }
  | { type: "Void" };

// ─── Type mapping ─────────────────────────────────────────────────────────────

function sorobanTypeToTs(t: SorobanType): string {
  switch (t.type) {
    case "U32":     return "number";
    case "U64":     return "bigint";
    case "I128":    return "bigint";
    case "Bool":    return "boolean";
    case "Address": return "string";
    case "String":
    case "Symbol":  return "string";
    case "BytesN":  return "Uint8Array";
    case "Bytes":   return "Uint8Array";
    case "Void":    return "void";
    case "Option":  return `${sorobanTypeToTs(t.value)} | null`;
    case "Vec":     return `Array<${sorobanTypeToTs(t.element)}>`;
    case "Map":     return `Map<${sorobanTypeToTs(t.key)}, ${sorobanTypeToTs(t.value)}>`;
    case "Custom":  return snakeToCamelType(t.name);
    default:        return "unknown";
  }
}

/**
 * Convert snake_case contract type names to PascalCase TypeScript names.
 * e.g. "invoice_status" → "InvoiceStatus"
 */
function snakeToCamelType(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Convert snake_case field names to camelCase TypeScript names.
 * e.g. "due_date" → "dueDate"
 */
function snakeToCamelField(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// ─── Code generators ──────────────────────────────────────────────────────────

function generateFileHeader(): string {
  return `/**
 * packages/shared/src/types.ts
 *
 * AUTO-GENERATED — do not edit by hand.
 * Source: Soroban contract spec (backend/target/spec.json)
 * Generator: scripts/generate-shared-types.mts
 *
 * To regenerate:
 *   pnpm generate:shared-types
 *
 * See docs/contracts/README.md for the full type-generation workflow.
 */

`;
}

function generateEnum(entry: SorobanSpecEntry): string {
  const tsName = snakeToCamelType(entry.name!);
  const doc = entry.doc ? `/** ${entry.doc} */\n` : "";
  const cases = (entry.cases ?? [])
    .map((c) => `  | "${c.name}"${c.doc ? ` // ${c.doc}` : ""}`)
    .join("\n");
  return `${doc}export type ${tsName} =\n${cases};\n`;
}

function generateStruct(entry: SorobanSpecEntry): string {
  const tsName = snakeToCamelType(entry.name!);
  const doc = entry.doc ? `/** ${entry.doc} */\n` : "";
  const fields = (entry.fields ?? [])
    .map((f) => {
      const tsField = snakeToCamelField(f.name);
      const tsType = sorobanTypeToTs(f.type);
      const fieldDoc = f.doc
        ? `  /** contract: ${f.name} — ${f.doc} */\n`
        : `  /** contract: ${f.name} */\n`;
      return `${fieldDoc}  ${tsField}: ${tsType};`;
    })
    .join("\n");
  return `${doc}export interface ${tsName} {\n${fields}\n}\n`;
}

function generateUnion(entry: SorobanSpecEntry): string {
  const tsName = snakeToCamelType(entry.name!);
  const doc = entry.doc ? `/** ${entry.doc} */\n` : "";
  const cases = (entry.cases ?? []).map((c) => {
    const fields = c.fields ?? [];
    if (c.type === "Unit" || fields.length === 0) {
      return `  | { type: "${c.name}" }`;
    }
    const innerFields = fields
      .map((f) => `${snakeToCamelField(f.name)}: ${sorobanTypeToTs(f.type)}`)
      .join("; ");
    return `  | { type: "${c.name}"; ${innerFields} }`;
  });
  return `${doc}export type ${tsName} =\n${cases.join("\n")};\n`;
}

// ─── Main generation ──────────────────────────────────────────────────────────

function generate(specFilePath: string): string {
  const raw = readFileSync(specFilePath, "utf-8");
  const spec: SorobanSpecEntry[] = JSON.parse(raw);

  const sections: string[] = [generateFileHeader()];

  // Collect type names for the index export list
  const exportedTypes: string[] = [];

  for (const entry of spec) {
    if (!entry.name) continue;

    let block: string | null = null;

    switch (entry.type) {
      case "UdtEnumV0":
        block = generateEnum(entry);
        exportedTypes.push(snakeToCamelType(entry.name));
        break;
      case "UdtStructV0":
        block = generateStruct(entry);
        exportedTypes.push(snakeToCamelType(entry.name));
        break;
      case "UdtUnionV0":
        block = generateUnion(entry);
        exportedTypes.push(snakeToCamelType(entry.name));
        break;
      // FunctionV0 and UdtErrorEnumV0 are intentionally skipped —
      // function signatures and error codes are not part of the shared types.
      default:
        break;
    }

    if (block) {
      sections.push(block);
    }
  }

  // Emit a generated index re-export block as a comment so the developer
  // can paste it into index.ts when regenerating.
  const indexComment = [
    "// ─── Generated export list (paste into src/index.ts) ───────────────────────",
    "// export type {",
    ...exportedTypes.map((t) => `//   ${t},`),
    "// } from './types';",
  ].join("\n");

  sections.push(indexComment + "\n");

  return sections.join("\n");
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const resolvedSpec = resolve(repoRoot, specPath);
let output: string;

try {
  output = generate(resolvedSpec);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") {
    console.error(
      `\nSpec file not found: ${resolvedSpec}\n\n` +
        `Build the contract first:\n` +
        `  cd backend && stellar contract build\n` +
        `  stellar contract info \\\n` +
        `    --wasm target/wasm32v1-none/release/*.wasm \\\n` +
        `    --output-format json > target/spec.json\n`
    );
    process.exit(1);
  }
  throw err;
}

if (dryRun) {
  process.stdout.write(output);
  console.error("\n[dry-run] Output written to stdout. No files changed.");
} else {
  if (!outPath) {
    console.error("--out <path> is required when not using --dry-run");
    process.exit(1);
  }
  const resolvedOut = resolve(repoRoot, outPath);
  writeFileSync(resolvedOut, output, "utf-8");
  console.log(`Generated ${resolvedOut} from ${resolvedSpec}`);
}
