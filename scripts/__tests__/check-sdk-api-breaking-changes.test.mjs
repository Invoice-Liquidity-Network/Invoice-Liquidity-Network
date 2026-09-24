import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareApiSnapshots,
  hasMajorChangeset,
  isUnionNarrowing,
} from '../check-sdk-api-breaking-changes.mjs';

function snapshot(exports) {
  return { version: 1, entry: 'sdk/src/index.ts', exports };
}

const base = snapshot({
  ILNSdk: {
    kind: 'class',
    typeParams: [],
    members: {
      fundInvoice: { type: '(p: SubmitInvoiceParams) => Promise<void>', optional: false },
    },
  },
  ContractError: { kind: 'enum', members: { InvoiceNotFound: 1, AlreadyFunded: 2 } },
  ILNError: {
    kind: 'class',
    typeParams: [],
    members: {
      code: { type: 'string', optional: false },
      retryable: { type: 'boolean', optional: false },
    },
  },
  Invoice: {
    kind: 'interface',
    typeParams: [],
    members: {
      id: { type: 'string', optional: false },
      amount: { type: 'bigint', optional: false },
    },
  },
  parseAmount: {
    kind: 'function',
    signatures: [
      {
        typeParams: [],
        params: [{ name: 'input', type: 'string | bigint', optional: false }],
        returnType: 'bigint',
      },
    ],
  },
  initialize: {
    kind: 'function',
    signatures: [
      {
        typeParams: [],
        params: [{ name: 'config', type: 'ILNSdkConfig', optional: true }],
        returnType: 'ILNSdk',
      },
    ],
  },
  status: { kind: 'type', type: 'Draft | Funded' },
  SDK_VERSION: { kind: 'const', type: '"0.1.0"' },
});

function changesFrom(baseline, current) {
  return compareApiSnapshots(baseline, current).changes;
}

test('identical snapshots produce no changes', () => {
  assert.deepEqual(changesFrom(base, base), []);
});

test('removed export is breaking', () => {
  const current = snapshot({ ...base.exports });
  delete current.exports.status;
  const changes = changesFrom(base, current);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].breaking, true);
  assert.match(changes[0].message, /status.*removed/);
});

test('added export is non-breaking', () => {
  const current = snapshot({ ...base.exports, NewFeature: { kind: 'const', type: 'string' } });
  const changes = changesFrom(base, current);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].breaking, false);
  assert.match(changes[0].message, /added/);
});

test('export kind change is breaking', () => {
  const current = snapshot({
    ...base.exports,
    ContractError: { kind: 'interface', typeParams: [], members: {} },
  });
  const breaking = changesFrom(base, current).filter((c) => c.breaking);
  assert.ok(breaking.some((c) => /changed kind/.test(c.message)));
});

test('enum member revalued is breaking; added member is not', () => {
  const current = snapshot({
    ...base.exports,
    ContractError: { kind: 'enum', members: { InvoiceNotFound: 1, AlreadyFunded: 3, NewCode: 9 } },
  });
  const changes = changesFrom(base, current);
  assert.ok(changes.some((c) => c.breaking && /revalued/.test(c.message)));
  assert.ok(changes.some((c) => !c.breaking && /NewCode.*added/.test(c.message)));
});

test('enum member removed is breaking', () => {
  const current = snapshot({
    ...base.exports,
    ContractError: { kind: 'enum', members: { AlreadyFunded: 2 } },
  });
  assert.ok(changesFrom(base, current).some((c) => c.breaking && /removed/.test(c.message)));
});

test('interface member removed is breaking; added is not', () => {
  const removed = snapshot({
    ...base.exports,
    Invoice: {
      kind: 'interface',
      typeParams: [],
      members: { id: { type: 'string', optional: false } },
    },
  });
  assert.ok(
    changesFrom(base, removed).some((c) => c.breaking && /amount.*removed/.test(c.message))
  );

  const added = snapshot({
    ...base.exports,
    Invoice: {
      kind: 'interface',
      typeParams: [],
      members: { ...base.exports.Invoice.members, note: { type: 'string', optional: true } },
    },
  });
  assert.ok(changesFrom(base, added).some((c) => !c.breaking && /note.*added/.test(c.message)));
});

test('interface member type changed is breaking', () => {
  const current = snapshot({
    ...base.exports,
    Invoice: {
      kind: 'interface',
      typeParams: [],
      members: {
        id: { type: 'string', optional: false },
        amount: { type: 'number', optional: false },
      },
    },
  });
  assert.ok(
    changesFrom(base, current).some((c) => c.breaking && /amount.*type changed/.test(c.message))
  );
});

test('param type changed is breaking', () => {
  const current = snapshot({
    ...base.exports,
    parseAmount: {
      kind: 'function',
      signatures: [
        {
          typeParams: [],
          params: [{ name: 'input', type: 'string', optional: false }],
          returnType: 'bigint',
        },
      ],
    },
  });
  assert.ok(
    changesFrom(base, current).some(
      (c) => c.breaking && /parameter "input".*type changed/.test(c.message)
    )
  );
});

test('added optional param is non-breaking', () => {
  const current = snapshot({
    ...base.exports,
    parseAmount: {
      kind: 'function',
      signatures: [
        {
          typeParams: [],
          params: [
            { name: 'input', type: 'string | bigint', optional: false },
            { name: 'strict', type: 'boolean', optional: true },
          ],
          returnType: 'bigint',
        },
      ],
    },
  });
  assert.ok(changesFrom(base, current).every((c) => !c.breaking));
});

test('optional param becoming required is breaking', () => {
  const current = snapshot({
    ...base.exports,
    initialize: {
      kind: 'function',
      signatures: [
        {
          typeParams: [],
          params: [{ name: 'config', type: 'ILNSdkConfig', optional: false }],
          returnType: 'ILNSdk',
        },
      ],
    },
  });
  assert.ok(
    changesFrom(base, current).some((c) => c.breaking && /became required/.test(c.message))
  );
});

test('union-narrowed return type is non-breaking', () => {
  const current = snapshot({
    ...base.exports,
    status: { kind: 'type', type: 'Draft' },
  });
  assert.ok(changesFrom(base, current).every((c) => !c.breaking));
});

test('a non-narrowing return type change is breaking', () => {
  const current = snapshot({
    ...base.exports,
    status: { kind: 'type', type: 'Paid' },
  });
  assert.ok(changesFrom(base, current).some((c) => c.breaking));
});

test('isUnionNarrowing heuristics', () => {
  assert.equal(isUnionNarrowing('a | b', 'a'), true);
  assert.equal(isUnionNarrowing('a | b', 'c'), false);
  assert.equal(isUnionNarrowing('unknown', 'RpcEndpointPool'), true);
  assert.equal(isUnionNarrowing('string', 'string'), false);
  assert.equal(isUnionNarrowing('string | number', 'number | string'), false);
});

test('hasMajorChangeset finds a major bump for @iln/sdk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iln-cs-'));
  writeFileSync(join(dir, 'a.md'), '---\n"@iln/sdk": minor\n---\n\nSome minor change.\n');
  writeFileSync(join(dir, 'b.md'), '---\n"@iln/sdk": major\n---\n\nA breaking change.\n');
  writeFileSync(join(dir, 'config.json'), '{"ignore":[]}\n');
  writeFileSync(join(dir, 'README.md'), '# changesets\n');
  assert.equal(hasMajorChangeset(dir, '@iln/sdk'), true);
  assert.equal(hasMajorChangeset(dir, '@iln/cli'), false);
});

test('hasMajorChangeset is false when only minor bumps exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iln-cs-'));
  writeFileSync(join(dir, 'a.md'), '---\n"@iln/sdk": minor\n---\n\nNon-breaking.\n');
  assert.equal(hasMajorChangeset(dir, '@iln/sdk'), false);
});

test('hasMajorChangeset is false when the directory is missing', () => {
  const dir = join(tmpdir(), 'iln-no-such-changeset-dir');
  assert.equal(hasMajorChangeset(dir, '@iln/sdk'), false);
});
