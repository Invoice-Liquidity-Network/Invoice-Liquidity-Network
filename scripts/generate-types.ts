#!/usr/bin/env node
/**
 * generate-types.ts
 *
 * Reads a Soroban contract spec JSON file (produced by `stellar contract info --output-format json`)
 * and generates TypeScript interfaces / type aliases into sdk/src/generated/types.ts.
 *
 * Usage:
 *   npx ts-node scripts/generate-types.ts [--spec <path>]
 *
 * Default spec path: ILN-Smart-Contract/target/spec.json
 */

import fs from 'fs';
import path from 'path';

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
    case 'Symbol':
    case 'Address':
      return 'string';
    case 'Bytes':
      return 'Uint8Array';
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
  const fields = entry.fields
    .map((f) => `  ${docComment(f.doc)}  ${f.name}: ${sorobanTypeToTs(f.type)};`)
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
const specPath =
  specFlagIdx !== -1
    ? args[specFlagIdx + 1]
    : path.resolve('ILN-Smart-Contract', 'target', 'spec.json');

const outPath = path.resolve('sdk', 'src', 'generated', 'types.ts');

if (!fs.existsSync(specPath)) {
  console.error(
    `Contract spec not found at: ${specPath}\n` +
      `Build the contract first:\n` +
      `  cd ILN-Smart-Contract && stellar contract build\n` +
      `  stellar contract info --wasm target/wasm32v1-none/release/*.wasm --output-format json > target/spec.json`
  );
  process.exit(1);
}

const spec: SpecEntry[] = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const sections: string[] = [
  `// !! AUTO-GENERATED — do not edit by hand.`,
  `// Re-generate with: pnpm generate:types`,
  `// Source: ${path.relative(process.cwd(), specPath)}`,
  ``,
];

for (const entry of spec) {
  switch (entry.type) {
    case 'SCSpecEntryUDTStructV0':
      sections.push(generateStruct(entry as StructEntry));
      break;
    case 'SCSpecEntryUDTEnumV0':
      sections.push(generateEnum(entry as EnumEntry));
      break;
    case 'SCSpecEntryUDTUnionV0':
      sections.push(generateUnion(entry as UnionEntry));
      break;
    case 'SCSpecEntryUDTErrorEnumV0':
      sections.push(generateErrorEnum(entry as ErrorEntry));
      break;
    // SCSpecEntryFunctionV0 — functions are handled by the SDK client, skip
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, sections.join('\n'));
console.log(
  `Generated ${sections.length - 4} type blocks → ${path.relative(process.cwd(), outPath)}`
);
