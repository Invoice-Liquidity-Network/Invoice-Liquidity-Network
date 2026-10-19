import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ChecklistParseError,
  listLegacyPages,
  parseChecklist,
  validateChecklist,
} from '../lib/docs-migration.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let root;

function write(rel, content = '# page\n') {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function checklist(body) {
  return `# Setup\n\n## Migration checklist\n\nIntro prose.\n\n- prose bullet ignored\n\n${body}\n\n---\n\n## Developer setup\n\n- [ ] not part of the checklist\n`;
}

function check(body) {
  write('docs/DOCS_SETUP.md', checklist(body));
  return validateChecklist(parseChecklist(checklist(body)), root);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'iln-docs-migration-'));
  write('docs/guide.md');
  write('docs/pending.md');
  write('packages/docs/content/guide.mdx');
  write('packages/docs/content/_meta.ts', "export default { guide: 'Guide' };");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const COMPLETE = `### Ported

- [x] Guide (\`docs/guide.md\` → \`packages/docs/content/guide.mdx\`)

### Remaining content to port

- [ ] Pending (\`docs/pending.md\`)

### Not migrating

- \`docs/DOCS_SETUP.md\` — maintainer guide

### Post-migration cleanup

- [ ] Remove \`docs/pages/\` directory
- [ ] Configure search`;

describe('parseChecklist', () => {
  test('parses ported, pending, excluded and cleanup items', () => {
    const parsed = parseChecklist(checklist(COMPLETE));
    assert.deepEqual(
      parsed.items.map(({ done, source, target }) => ({ done, source, target })),
      [
        { done: true, source: 'docs/guide.md', target: 'packages/docs/content/guide.mdx' },
        { done: false, source: 'docs/pending.md', target: null },
      ]
    );
    assert.deepEqual(
      parsed.excluded.map((entry) => entry.source),
      ['docs/DOCS_SETUP.md']
    );
    assert.deepEqual(
      parsed.cleanup.map((item) => item.removes),
      ['docs/pages/', null]
    );
  });

  test('fails closed on an item in an unrecognised format', () => {
    assert.throws(
      () =>
        parseChecklist(checklist('### Ported\n\n- [x] Guide → packages/docs/content/guide.mdx')),
      (err) => err instanceof ChecklistParseError && err.line > 0
    );
  });

  test('fails closed on an excluded entry without a reason', () => {
    assert.throws(
      () => parseChecklist(checklist('### Not migrating\n\n- `docs/x.md`')),
      ChecklistParseError
    );
  });

  test('fails when the checklist section is missing', () => {
    assert.throws(() => parseChecklist('# Setup\n'), /missing "## Migration checklist"/);
  });
});

describe('validateChecklist', () => {
  test('passes a complete, truthful checklist', () => {
    const result = check(COMPLETE);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.summary, {
      ported: 1,
      pending: 1,
      excluded: 1,
      tracked: 3,
      cleanupDone: 0,
      cleanupTotal: 2,
    });
  });

  test('fails when a legacy page is not tracked', () => {
    write('docs/new-page.md');
    const messages = check(COMPLETE).errors.map((error) => error.message);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /`docs\/new-page\.md` is not in the migration checklist/);
  });

  test('fails when a ticked target does not exist', () => {
    const body = COMPLETE.replace('content/guide.mdx`)', 'content/missing.mdx`)');
    assert.match(check(body).errors[0].message, /does not exist/);
  });

  test('fails when a ticked target exists but is not in the canonical nav', () => {
    write('packages/docs/content/_meta.ts', 'export default {};');
    assert.match(check(COMPLETE).errors[0].message, /not declared in the canonical _meta\.ts/);
  });

  test('fails when a ticked item has no target', () => {
    const body = COMPLETE.replace(' → `packages/docs/content/guide.mdx`', '');
    assert.match(check(body).errors[0].message, /ticked but has no/);
  });

  test('fails when a page is ported but left unticked', () => {
    write('packages/docs/content/pending.mdx');
    const body = COMPLETE.replace(
      '- [ ] Pending (`docs/pending.md`)',
      '- [ ] Pending (`docs/pending.md` → `packages/docs/content/pending.mdx`)'
    );
    assert.match(check(body).errors[0].message, /ported to .* but not ticked/);
  });

  test('fails when a pending source has been deleted', () => {
    rmSync(join(root, 'docs/pending.md'));
    assert.match(check(COMPLETE).errors[0].message, /no longer exists/);
  });

  test('fails on duplicate sources', () => {
    const body = COMPLETE.replace(
      '- [ ] Pending (`docs/pending.md`)',
      '- [ ] Pending (`docs/pending.md`)\n- [ ] Pending again (`docs/pending.md`)'
    );
    assert.match(check(body).errors[0].message, /listed more than once/);
  });

  test('fails when a ticked "Remove" cleanup item still exists', () => {
    write('docs/pages/_app.tsx', '');
    const body = COMPLETE.replace('- [ ] Remove `docs/pages/`', '- [x] Remove `docs/pages/`');
    assert.match(check(body).errors[0].message, /still exists/);
  });

  test('ignores non-content legacy directories', () => {
    write('docs/node_modules/pkg/README.md');
    write('docs/pages/readme.md');
    write('docs/DOCS_SETUP.md');
    assert.deepEqual(listLegacyPages(root), [
      'docs/DOCS_SETUP.md',
      'docs/guide.md',
      'docs/pending.md',
    ]);
  });
});

describe('repository checklist', () => {
  test('docs/DOCS_SETUP.md is complete and in sync with the repository', () => {
    const markdown = readFileSync(join(repoRoot, 'docs', 'DOCS_SETUP.md'), 'utf8');
    const result = validateChecklist(parseChecklist(markdown), repoRoot);
    assert.deepEqual(result.errors, []);
    assert.equal(result.summary.tracked, listLegacyPages(repoRoot).length);
  });
});
