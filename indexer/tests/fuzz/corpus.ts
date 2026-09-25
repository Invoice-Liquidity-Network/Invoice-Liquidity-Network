import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { xdr } from '@stellar/stellar-sdk';
import { ABSENT, type InvoiceScript, type RawEventShape } from './arbitraries';

/**
 * Persisted fuzz counterexamples. Every case the fuzzer finds is written here
 * and replayed by tests/processor.corpus.test.ts on every run, so a fixed
 * failure can never come back unnoticed.
 */
export const CORPUS_DIR = join(__dirname, '..', 'fuzz-corpus');

export interface CorpusCase {
  name: string;
  found: string;
  property: string;
  /** Free-text description of what went wrong before the fix. */
  finding: string;
  event: Record<string, unknown>;
  invoice: InvoiceScript;
  expect: {
    outcome: 'processed' | 'ignored' | 'malformed' | 'throws';
    reason?: string;
  };
}

function encode(value: unknown): unknown {
  if (value === ABSENT) return { $absent: true };
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (typeof value === 'number' && Number.isNaN(value)) return { $nan: true };
  if (typeof value === 'undefined') return { $absent: true };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { toXDR?: (f: string) => string; switch?: unknown };
    if (typeof candidate.toXDR === 'function' && typeof candidate.switch === 'function') {
      return { $xdr: candidate.toXDR('base64') };
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.$absent) return ABSENT;
    if (typeof record.$bigint === 'string') return BigInt(record.$bigint);
    if (record.$nan) return Number.NaN;
    if (typeof record.$xdr === 'string') return xdr.ScVal.fromXDR(record.$xdr, 'base64');
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}

export function serializeShape(shape: RawEventShape): Record<string, unknown> {
  return encode(shape) as Record<string, unknown>;
}

export function deserializeShape(encoded: Record<string, unknown>): RawEventShape {
  return decode(encoded) as RawEventShape;
}

export function loadCorpus(dir = CORPUS_DIR): CorpusCase[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as CorpusCase);
}

/** Writes a counterexample as a new corpus file; returns its path. */
export function persistCounterexample(
  property: string,
  shape: RawEventShape,
  invoice: InvoiceScript,
  error: unknown,
  dir = CORPUS_DIR
): string {
  mkdirSync(dir, { recursive: true });
  const encodedEvent = serializeShape(shape);
  const hash = createHash('sha256')
    .update(JSON.stringify({ property, encodedEvent, invoice }))
    .digest('hex')
    .slice(0, 12);
  const file = join(dir, `fuzz-${property}-${hash}.json`);
  const record: CorpusCase = {
    name: `fuzz-${property}-${hash}`,
    found: new Date().toISOString().slice(0, 10),
    property,
    finding: `UNREVIEWED: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
    event: encodedEvent,
    invoice,
    expect: { outcome: 'processed' },
  };
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  return file;
}
