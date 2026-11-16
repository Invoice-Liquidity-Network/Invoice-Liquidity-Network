#!/usr/bin/env node
/**
 * generate-types.ts
 *
 * Reads a Soroban contract spec JSON file (produced by `stellar contract info --output-format json`)
 * and generates TypeScript interfaces / type aliases into sdk/src/generated/types.ts.
 *
 * Usage:
 *   npx ts-node scripts/generate-types.ts [--spec <path>] [--output <path>]
 *
 * Default spec path: backend/target/spec.json
 * Default output: sdk/src/generated/types.ts
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Version tracking
// ---------------------------------------------------------------------------

const SDK_VERSION = '0.1.0';

// NOTE (issue #1078): no wall-clock timestamp is embedded in the generated
// header. Regenerating from the same spec must produce a byte-identical file,
// otherwise `pnpm generate:types` always diffs and reproducible-build
// verification can never pass.

/**
 * Compute a hash of the spec file for version tracking.
 */
function computeSpecHash(specPath: string): string {
  const content = fs.readFileSync(specPath, 'utf8');
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

// ---------------------------------------------------------------------------
// Soroban spec types (subset we care about)
// ---------------------------------------------------------------------------

interface SpecEntry {
  type: string;
  name?: string;
  doc?: string;
}

interface StructField {
  name: string;
  type: SorobanType;
  doc?: string;
}

interface StructEntry extends SpecEntry {
  type: 'SCSpecEntryUDTStructV0';
  name: string;
  fields: StructField[];
}

interface EnumCase {
  name: string;
  value: number;
  doc?: string;
}

interface EnumEntry extends SpecEntry {
  type: 'SCSpecEntryUDTEnumV0';
  name: string;
  cases: EnumCase[];
}

interface UnionCase {
  kind: 'VoidCase' | 'TupleCase';
  name: string;
  type?: SorobanType[];
  doc?: string;
}

interface UnionEntry extends SpecEntry {
  type: 'SCSpecEntryUDTUnionV0';
  name: string;
  cases: UnionCase[];
}

interface ErrorCase {
  name: string;
  value: number;
  doc?: string;
}

interface ErrorEntry extends SpecEntry {
  type: 'SCSpecEntryUDTErrorEnumV0';
  name: string;
  cases: ErrorCase[];
}

type SorobanType =
  | { type: 'U32' }
  | { type: 'I32' }
  | { type: 'U64' }
  | { type: 'I64' }
  | { type: 'U128' }
  | { type: 'I128' }
  | { type: 'Bool' }
  | { type: 'String' }
  | { type: 'Symbol' }
  | { type: 'Address' }
  | { type: 'Bytes' }
  | { type: 'BytesN'; n: number }
  | { type: 'Void' }
  | { type: 'Option'; valueType: SorobanType }
  | { type: 'Vec'; elementType: SorobanType }
  | { type: 'Map'; keyType: SorobanType; valueType: SorobanType }
  | { type: 'Tuple'; types: SorobanType[] }
  | { type: 'Custom'; name: string };

// ---------------------------------------------------------------------------
// Custom type mappings
// ---------------------------------------------------------------------------

/**
 * Custom type mappings allow overriding default Soroban-to-TypeScript type
 * conversions. For example, mapping Address to a branded string type.
 */
interface CustomTypeMappings {
  sorobanToTs?: Record<string, string>;
  structOverrides?: Record<string, Record<string, string>>;
}

const CUSTOM_TYPE_MAPPINGS: CustomTypeMappings = {
  sorobanToTs: {
    Address: 'string',
    Symbol: 'string',
    Bytes: 'Uint8Array',
  },
};

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

function sorobanTypeToTs(t: SorobanType): string {
  switch (t.type) {
    case 'U32':
    case 'I32':
      return 'number';
    case 'U64':
    case 'I64':
    case 'U128':
    case 'I128':
      return 'bigint';
    case 'Bool':
      return 'boolean';
    case 'String':
      return 'string';
    case 'Symbol':
      return CUSTOM_TYPE_MAPPINGS.sorobanToTs?.Symbol ?? 'string';
    case 'Address':
      return CUSTOM_TYPE_MAPPINGS.sorobanToTs?.Address ?? 'string';
    case 'Bytes':
      return CUSTOM_TYPE_MAPPINGS.sorobanToTs?.Bytes ?? 'Uint8Array';
    case 'BytesN':
      return 'Uint8Array';
    case 'Void':
      return 'void';
    case 'Option':
      return `${sorobanTypeToTs(t.valueType)} | null`;
    case 'Vec':
      return `${sorobanTypeToTs(t.elementType)}[]`;
    case 'Map':
      return `Map<${sorobanTypeToTs(t.keyType)}, ${sorobanTypeToTs(t.valueType)}>`;
    case 'Tuple':
      return `[${t.types.map(sorobanTypeToTs).join(', ')}]`;
    case 'Custom':
      return t.name;
  }
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function docComment(doc?: string): string {
  if (!doc?.trim()) return '';
  return `/** ${doc.trim()} */\n`;
}

function generateStruct(entry: StructEntry): string {
  const overrides = CUSTOM_TYPE_MAPPINGS.structOverrides?.[entry.name] ?? {};
  const fields = entry.fields
    .map((f) => {
      const typeOverride = overrides[f.name];
      const tsType = typeOverride ?? sorobanTypeToTs(f.type);
      return `  ${docComment(f.doc)}  ${f.name}: ${tsType};`;
    })
    .join('\n');
  return `${docComment(entry.doc)}export interface ${entry.name} {\n${fields}\n}\n`;
}

function generateEnum(entry: EnumEntry): string {
  const members = entry.cases
    .map((c) => `  ${docComment(c.doc)}  ${c.name} = ${c.value},`)
    .join('\n');
  return `${docComment(entry.doc)}export enum ${entry.name} {\n${members}\n}\n`;
}

function generateUnion(entry: UnionEntry): string {
  const variants = entry.cases.map((c) => {
    if (c.kind === 'VoidCase') return `  | { tag: "${c.name}" }`;
    const types = (c.type ?? []).map(sorobanTypeToTs).join(', ');
    return `  | { tag: "${c.name}"; values: [${types}] }`;
  });
  return `${docComment(entry.doc)}export type ${entry.name} =\n${variants.join('\n')};\n`;
}

function generateErrorEnum(entry: ErrorEntry): string {
  const members = entry.cases
    .map((c) => `  ${docComment(c.doc)}  ${c.name} = ${c.value},`)
    .join('\n');
  return `${docComment(entry.doc)}export enum ${entry.name} {\n${members}\n}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const specFlagIdx = args.indexOf('--spec');
const outputFlagIdx = args.indexOf('--output');

const specPath =
  specFlagIdx !== -1 ? args[specFlagIdx + 1] : path.resolve('backend', 'target', 'spec.json');

const outPath =
  outputFlagIdx !== -1
    ? args[outputFlagIdx + 1]
    : path.resolve('sdk', 'src', 'generated', 'types.ts');

if (!fs.existsSync(specPath)) {
  console.error(
    `Contract spec not found at: ${specPath}\n` +
      `Build the contract first:\n` +
      `  cd backend && cargo build --target wasm32v1-none --release\n` +
      `  stellar contract info --wasm target/wasm32v1-none/release/*.wasm --output-format json > target/spec.json`
  );
  process.exit(1);
}

function normalizeSorobanType(value: unknown): SorobanType {
  if (typeof value === 'string') {
    const scalars: Record<string, SorobanType['type']> = {
      bool: 'Bool',
      u32: 'U32',
      i32: 'I32',
      u64: 'U64',
      i64: 'I64',
      u128: 'U128',
      i128: 'I128',
      address: 'Address',
      symbol: 'Symbol',
      string: 'String',
      bytes: 'Bytes',
      void: 'Void',
    };
    const scalar = scalars[value];
    if (scalar) return { type: scalar } as SorobanType;
    return { type: 'Custom', name: value };
  }
  if (value && typeof value === 'object') {
    const entry = value as Record<string, any>;
    if (entry.type) return entry as SorobanType;
    if (entry.bytes_n) return { type: 'BytesN', n: entry.bytes_n.n };
    if (entry.vec) {
      return { type: 'Vec', elementType: normalizeSorobanType(entry.vec.element_type) };
    }
    if (entry.option) {
      return { type: 'Option', valueType: normalizeSorobanType(entry.option.value_type) };
    }
    if (entry.tuple) {
      return {
        type: 'Tuple',
        types: (entry.tuple.value_types ?? []).map(normalizeSorobanType),
      };
    }
    if (entry.udt) return { type: 'Custom', name: entry.udt.name };
  }
  return { type: 'Custom', name: 'unknown' };
}

function normalizeSpec(raw: unknown): SpecEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: SpecEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, any>;
    if (typeof entry.type === 'string') {
      entries.push(entry as SpecEntry);
      continue;
    }
    if (entry.udt_struct_v0) {
      const struct = entry.udt_struct_v0;
      entries.push({
        type: 'SCSpecEntryUDTStructV0',
        name: struct.name,
        doc: struct.doc,
        fields: (struct.fields ?? []).map((field: any) => ({
          name: field.name,
          doc: field.doc,
          type: normalizeSorobanType(field.type),
        })),
      } as StructEntry);
    } else if (entry.udt_enum_v0 || entry.udt_error_enum_v0) {
      const enumerated = entry.udt_enum_v0 ?? entry.udt_error_enum_v0;
      entries.push({
        type: entry.udt_error_enum_v0 ? 'SCSpecEntryUDTErrorEnumV0' : 'SCSpecEntryUDTEnumV0',
        name: enumerated.name,
        doc: enumerated.doc,
        cases: enumerated.cases ?? [],
      } as EnumEntry);
    } else if (entry.udt_union_v0) {
      const union = entry.udt_union_v0;
      entries.push({
        type: 'SCSpecEntryUDTUnionV0',
        name: union.name,
        doc: union.doc,
        cases: (union.cases ?? []).map((unionCase: any) => {
          if (unionCase.void_v0) {
            return { kind: 'VoidCase', name: unionCase.void_v0.name, doc: unionCase.void_v0.doc };
          }
          const tuple = unionCase.tuple_v0;
          return {
            kind: 'TupleCase',
            name: tuple?.name ?? 'Unknown',
            doc: tuple?.doc,
            type: (tuple?.type ?? []).map(normalizeSorobanType),
          };
        }),
      } as UnionEntry);
    }
  }
  return entries;
}

const spec: SpecEntry[] = normalizeSpec(JSON.parse(fs.readFileSync(specPath, 'utf8')));
const specHash = computeSpecHash(specPath);

const sections: string[] = [
  `// !! AUTO-GENERATED — do not edit by hand.`,
  `// Re-generate with: pnpm generate:types`,
  `// Source: ${path.relative(process.cwd(), specPath)}`,
  `// Spec hash: ${specHash}`,
  `// SDK version: ${SDK_VERSION}`,
  ``,
];

let typeCount = 0;
for (const entry of spec) {
  switch (entry.type) {
    case 'SCSpecEntryUDTStructV0':
      sections.push(generateStruct(entry as StructEntry));
      typeCount++;
      break;
    case 'SCSpecEntryUDTEnumV0':
      sections.push(generateEnum(entry as EnumEntry));
      typeCount++;
      break;
    case 'SCSpecEntryUDTUnionV0':
      sections.push(generateUnion(entry as UnionEntry));
      typeCount++;
      break;
    case 'SCSpecEntryUDTErrorEnumV0':
      sections.push(generateErrorEnum(entry as ErrorEntry));
      typeCount++;
      break;
    // SCSpecEntryFunctionV0 — functions are handled by the SDK client, skip
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, sections.join('\n'));
console.log(
  `Generated ${typeCount} type blocks from spec (hash: ${specHash}) → ${path.relative(
    process.cwd(),
    outPath
  )}`
);
