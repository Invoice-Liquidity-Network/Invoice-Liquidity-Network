/**
 * scripts/lib/docs-migration.mjs
 *
 * Machine-checks the canonical docs migration checklist in
 * `docs/DOCS_SETUP.md` (#1283). The checklist used to be prose only: boxes
 * could be ticked for pages that were never ported, ported pages could stay
 * unticked, and legacy pages could be missing from it entirely.
 *
 * Inside the `## Migration checklist` section, three kinds of list items are
 * recognised:
 *
 *   - [x] Label (`docs/src.md` → `packages/docs/content/dst.mdx`)   ported
 *   - [ ] Label (`docs/src.md`)                                     pending
 *   - `docs/src.md` — reason                                        excluded
 *     (only under `### Not migrating`)
 *
 * Items under `### Post-migration cleanup` are free-form, except that a
 * ticked "Remove `path`" item asserts that `path` no longer exists.
 *
 * Any other `- ` list item in a `###` subsection is a parse error, so the
 * checklist cannot drift into a format the checker silently ignores.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { isRegisteredInNav } from './docs-nav.mjs';

const CHECKLIST_HEADING = '## Migration checklist';
const CLEANUP_HEADING = 'Post-migration cleanup';
const EXCLUDED_HEADING = 'Not migrating';

const ITEM_RE =
  /^- \[(?<mark>[ xX])\] (?<label>.+?) \(`(?<source>docs\/[^`]+)`(?: → `(?<target>packages\/docs\/content\/[^`]+)`)?\)\s*$/;
const EXCLUDED_RE = /^- `(?<source>docs\/[^`]+)` — (?<reason>\S.*)$/;
const CLEANUP_RE = /^- \[(?<mark>[ xX])\] (?<text>.+)$/;
const REMOVE_RE = /^Remove `(?<path>[^`]+)`/;

/** Legacy directories that hold no content pages. */
const LEGACY_IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  'pages',
  'components',
  'scripts',
  'public',
]);

export class ChecklistParseError extends Error {
  constructor(message, line) {
    super(`DOCS_SETUP.md:${line} ${message}`);
    this.name = 'ChecklistParseError';
    this.line = line;
    this.reason = message;
  }
}

/**
 * Parse the migration checklist out of DOCS_SETUP.md source.
 * Returns `{ items, excluded, cleanup }`; throws ChecklistParseError.
 */
export function parseChecklist(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === CHECKLIST_HEADING);
  if (start === -1) throw new ChecklistParseError(`missing "${CHECKLIST_HEADING}" section`, 1);

  const items = [];
  const excluded = [];
  const cleanup = [];
  let section = null;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (/^## /.test(line)) break;

    const heading = line.match(/^### (.+?)\s*$/);
    if (heading) {
      section = heading[1];
      continue;
    }
    // Prose before the first subsection is ignored; a page listed there is
    // still caught by the "not in the migration checklist" completeness check.
    if (section === null || !line.startsWith('- ')) continue;

    if (section === CLEANUP_HEADING) {
      const match = line.match(CLEANUP_RE);
      if (!match)
        throw new ChecklistParseError('cleanup items must be "- [ ] ..." checkboxes', lineNo);
      const remove = match.groups.text.match(REMOVE_RE);
      cleanup.push({
        line: lineNo,
        done: match.groups.mark !== ' ',
        text: match.groups.text,
        removes: remove ? remove.groups.path : null,
      });
      continue;
    }

    if (section === EXCLUDED_HEADING) {
      const match = line.match(EXCLUDED_RE);
      if (!match) {
        throw new ChecklistParseError('expected "- `docs/<file>` — <reason>"', lineNo);
      }
      excluded.push({ line: lineNo, section, ...match.groups });
      continue;
    }

    const match = line.match(ITEM_RE);
    if (!match) {
      throw new ChecklistParseError(
        'expected "- [ ] Label (`docs/<file>`)" or "- [x] Label (`docs/<file>` → `packages/docs/content/<file>`)"',
        lineNo
      );
    }
    items.push({
      line: lineNo,
      section,
      done: match.groups.mark !== ' ',
      label: match.groups.label,
      source: match.groups.source,
      target: match.groups.target ?? null,
    });
  }

  return { items, excluded, cleanup };
}

/** Every legacy content page (`docs/**\/*.md`), repo-relative with `/`. */
export function listLegacyPages(repoRoot) {
  const docsRoot = join(repoRoot, 'docs');
  const pages = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!LEGACY_IGNORED_DIRS.has(entry) && !entry.startsWith('.')) walk(full);
      } else if (['.md', '.mdx'].includes(extname(entry))) {
        pages.push(relative(repoRoot, full).split(/[\\/]/).join('/'));
      }
    }
  };
  if (existsSync(docsRoot)) walk(docsRoot);
  return pages.sort();
}

/**
 * Validate a parsed checklist against the repository.
 * Returns `{ summary, errors }`; `errors` empty means the checklist is truthful
 * and complete.
 */
export function validateChecklist(checklist, repoRoot) {
  const errors = [];
  const contentRoot = resolve(repoRoot, 'packages', 'docs', 'content');
  const err = (line, message) => errors.push({ line, message });
  const exists = (path) => existsSync(resolve(repoRoot, path));

  const bySource = new Map();
  for (const entry of [...checklist.items, ...checklist.excluded]) {
    if (bySource.has(entry.source)) {
      err(
        entry.line,
        `\`${entry.source}\` is listed more than once (also line ${
          bySource.get(entry.source).line
        })`
      );
      continue;
    }
    bySource.set(entry.source, entry);
  }

  for (const item of checklist.items) {
    if (item.done) {
      if (!item.target) {
        err(
          item.line,
          `"${item.label}" is ticked but has no → \`packages/docs/content/...\` target`
        );
        continue;
      }
      if (!exists(item.target)) {
        err(item.line, `"${item.label}" is ticked but \`${item.target}\` does not exist`);
        continue;
      }
      if (!isRegisteredInNav(contentRoot, resolve(repoRoot, item.target))) {
        err(
          item.line,
          `"${item.label}" is ticked but \`${item.target}\` is not declared in the canonical _meta.ts navigation`
        );
      }
    } else {
      if (!exists(item.source)) {
        err(
          item.line,
          `"${item.label}" is pending but its source \`${item.source}\` no longer exists`
        );
      }
      if (item.target && exists(item.target)) {
        err(item.line, `"${item.label}" is ported to \`${item.target}\` but not ticked`);
      }
    }
  }

  for (const entry of checklist.excluded) {
    if (!exists(entry.source)) {
      err(entry.line, `excluded page \`${entry.source}\` no longer exists; remove the entry`);
    }
  }

  for (const item of checklist.cleanup) {
    if (item.done && item.removes && exists(item.removes)) {
      err(item.line, `cleanup "${item.text}" is ticked but \`${item.removes}\` still exists`);
    }
  }

  const untracked = listLegacyPages(repoRoot).filter((page) => !bySource.has(page));
  for (const page of untracked) {
    err(
      0,
      `legacy page \`${page}\` is not in the migration checklist; add it under "Remaining content to port" or "Not migrating"`
    );
  }

  const ported = checklist.items.filter((item) => item.done).length;
  return {
    summary: {
      ported,
      pending: checklist.items.length - ported,
      excluded: checklist.excluded.length,
      tracked: checklist.items.length + checklist.excluded.length,
      cleanupDone: checklist.cleanup.filter((item) => item.done).length,
      cleanupTotal: checklist.cleanup.length,
    },
    errors,
  };
}
