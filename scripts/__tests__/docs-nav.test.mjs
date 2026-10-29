import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MetaParseError,
  isRegisteredInNav,
  parseMetaSource,
  validateContentTree,
} from '../lib/docs-nav.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let root;

function write(rel, content = '# page\n') {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function errorsOf(report, kind) {
  return report.errors.filter((error) => !kind || error.kind === kind);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'iln-docs-nav-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('parseMetaSource', () => {
  test('parses the forms used by packages/docs/content', () => {
    const { imports, value } = parseMetaSource(`
      // comment
      import generatedMeta from './generated/_meta';
      import type { MetaRecord } from 'nextra';
      /* block */
      export default {
        index: { title: 'Getting Started', type: 'page' },
        'protocol-overview': "Protocol \\"Overview\\"",
        hidden: { display: 'hidden', theme: { toc: false, layout: 'full' } },
        ...generatedMeta,
      } satisfies MetaRecord;
    `);
    assert.equal(imports.get('generatedMeta').spec, './generated/_meta');
    assert.deepEqual(
      value.members.map((member) => member.key ?? `...${member.name}`),
      ['index', 'protocol-overview', 'hidden', '...generatedMeta']
    );
  });

  test('accepts the JSON-style output written by the SDK docs generator', () => {
    const { value } = parseMetaSource(
      '// auto-generated\nexport default {\n  "classes": "Classes",\n  "functions": "Functions"\n};\n'
    );
    assert.equal(value.members.length, 2);
  });

  for (const [name, source, reason] of [
    ['missing comma', "export default { a: 'A' b: 'B' }", /expected "," or "}"/],
    ['unterminated string', "export default { a: 'A }", /unterminated string/],
    ['template literal', 'export default { a: `A` }', /template literals/],
    ['computed value', "export default { a: title('A') }", /unexpected character "\("/],
    ['no default export', "const meta = { a: 'A' }", /unexpected character "="/],
    ['named export', "export const meta = { a: 'A' }", /unexpected character "="/],
    ['export without default', "export { a: 'A' }", /expected "default"/],
    ['non-object default', "export default 'nav'", /must be an object literal/],
    ['trailing code', "export default { a: 'A' }; extra", /after the default export/],
    ['unsupported syntax', "export default { a: 'A' }; console.log(1)", /unexpected character/],
    ['package import', "import x from 'nextra'; export default { ...x }", /only relative imports/],
    ['empty file', '', /expected "export default"/],
  ]) {
    test(`rejects ${name} with a positioned error`, () => {
      assert.throws(
        () => parseMetaSource(source, 'content/_meta.ts'),
        (err) => err instanceof MetaParseError && reason.test(err.reason) && err.line >= 1
      );
    });
  }
});

describe('validateContentTree', () => {
  test('passes a tree whose _meta files match the pages', () => {
    write('index.mdx');
    write('guide/intro.mdx');
    write('_meta.ts', "export default { index: 'Home', guide: { title: 'Guide', type: 'page' } };");
    write('guide/_meta.ts', "export default { intro: 'Intro' };");

    const report = validateContentTree(root);
    assert.deepEqual(report.errors, []);
    assert.equal(report.metaFiles, 2);
    assert.equal(report.entries, 3);
  });

  test('fails closed on a parse error instead of treating the file as empty', () => {
    write('index.mdx');
    write('_meta.ts', "export default { index: 'Home', ");

    const report = validateContentTree(root);
    assert.equal(errorsOf(report, 'parse').length, 1);
    assert.match(errorsOf(report, 'parse')[0].file, /_meta\.ts$/);
  });

  test('reports orphaned entries and undiscoverable pages', () => {
    write('index.mdx');
    write('extra.mdx');
    write('_meta.ts', "export default { index: 'Home', deleted: 'Deleted page' };");

    const report = validateContentTree(root);
    assert.deepEqual(
      errorsOf(report, 'orphaned').map((error) => error.message),
      ['"deleted" has no matching page or directory']
    );
    assert.deepEqual(
      errorsOf(report, 'undiscoverable').map((error) => error.message),
      ['"extra" exists but is not declared in _meta.ts']
    );
  });

  test('reports duplicate keys, including ones introduced by a spread', () => {
    write('a.mdx');
    write('generated/_meta.ts', "export default { a: 'Generated A' };");
    write('_meta.ts', "import gen from './generated/_meta';\nexport default { a: 'A', ...gen };");

    const report = validateContentTree(root);
    assert.equal(errorsOf(report, 'duplicate').length, 1);
    assert.match(errorsOf(report, 'duplicate')[0].message, /duplicate key "a"/);
  });

  test('reports schema errors: unknown fields, bad enums, empty titles', () => {
    write('a.mdx');
    write('b.mdx');
    write('c.mdx');
    write('d.mdx');
    write(
      '_meta.ts',
      `export default {
        a: { tilte: 'Typo' },
        b: { title: 'B', type: 'tab' },
        c: '  ',
        d: { title: 'D', display: 'invisible' },
      };`
    );

    const messages = errorsOf(validateContentTree(root), 'schema').map((error) => error.message);
    assert.deepEqual(messages, [
      '"a" has unknown field "tilte"',
      '"b".type must be one of page, doc, separator, menu',
      '"c" has an empty title',
      '"d".display must be one of normal, hidden, children',
    ]);
  });

  test('does not require pages for separators, links or the * wildcard', () => {
    write('index.mdx');
    write(
      '_meta.ts',
      `export default {
        '*': { theme: { toc: true } },
        '-- Section --': { type: 'separator', title: 'Section' },
        github: { title: 'GitHub', href: 'https://github.com' },
        index: 'Home',
      };`
    );
    assert.deepEqual(validateContentTree(root).errors, []);
  });

  test('reports an unresolvable spread import and a spread of an unknown name', () => {
    write('index.mdx');
    write(
      '_meta.ts',
      "import gen from './missing/_meta';\nexport default { index: 'Home', ...gen, ...other };"
    );

    const messages = errorsOf(validateContentTree(root), 'parse').map((error) => error.message);
    assert.deepEqual(messages, [
      'cannot resolve import "./missing/_meta"',
      'spread of "other" which is not a default import',
    ]);
  });

  test('rejects legacy _meta.json files in the canonical tree', () => {
    write('index.mdx');
    write('_meta.ts', "export default { index: 'Home' };");
    write('_meta.json', '{"index": "Home"}');
    assert.match(errorsOf(validateContentTree(root), 'schema')[0].message, /ignores _meta\.json/);
  });

  test('fails when the content directory is missing', () => {
    assert.equal(validateContentTree(join(root, 'nope')).errors.length, 1);
  });

  test('ignores directories without pages (e.g. an empty generated/ folder)', () => {
    write('index.mdx');
    write('generated/_meta.ts', 'export default {};');
    write(
      '_meta.ts',
      "import gen from './generated/_meta';\nexport default { index: 'Home', ...gen };"
    );
    assert.deepEqual(validateContentTree(root).errors, []);
  });
});

describe('isRegisteredInNav', () => {
  test('requires the page to be declared at every _meta level', () => {
    write('guide/intro.mdx');
    write('guide/secret.mdx');
    write('_meta.ts', "export default { guide: 'Guide' };");
    write('guide/_meta.ts', "export default { intro: 'Intro' };");

    assert.equal(isRegisteredInNav(root, join(root, 'guide/intro.mdx')), true);
    assert.equal(isRegisteredInNav(root, join(root, 'guide/secret.mdx')), false);
    assert.equal(isRegisteredInNav(root, join(root, '../outside.mdx')), false);
  });

  test('treats a directory without _meta as automatically listed', () => {
    write('auto/page.mdx');
    write('_meta.ts', "export default { auto: 'Auto' };");
    assert.equal(isRegisteredInNav(root, join(root, 'auto/page.mdx')), true);
  });
});

describe('repository canonical navigation', () => {
  test('packages/docs/content has no navigation errors', () => {
    const report = validateContentTree(join(repoRoot, 'packages', 'docs', 'content'));
    assert.deepEqual(report.errors, []);
    assert.ok(report.metaFiles > 0);
  });
});
