#!/usr/bin/env node
/**
 * Internal markdown link checker for the docs site.
 *
 * Walks the docs/ directory, finds every markdown link of the form:
 *   [text](./relative/or/absolute/path)
 *
 * and verifies that the target file or anchor exists. Exits with a non-zero
 * status and a human-readable diff if any link is broken.
 *
 * This replaces the previously no-op `"test": "echo \"no tests\""` script in
 * docs/package.json so that broken MDX, missing pages, or stale anchor links
 * can't silently reach production.
 *
 * Scope:
 *   - Only checks relative links that start with `./`, `../`, or are a
 *     bare filename. Absolute http(s) URLs are not verified here; the
 *     site-deploy workflow does not rely on remote link checks.
 *   - Only `.md` / `.mdx` targets reachable from the docs/ subtree are
 *     considered. `_meta.json` and other metadata files are ignored.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(__dirname, '..');
const PACKAGES_DOCS_ROOT = resolve(DOCS_ROOT, '..', 'packages', 'docs');
const SEARCH_ROOTS = [DOCS_ROOT, PACKAGES_DOCS_ROOT];

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);
// Match [text](href) but ignore inline code, images, and HTML <a href>.
const LINK_RE = /(?<!\!)\[(?<text>[^\]\n]*)\]\((?<href>[^)\s]+)(?:\s+["'(][^)"']+["')])?\)/g;
// Match a heading in a markdown file, returning its slug.
const HEADING_RE = /^(#+)\s+(.+?)\s*$/gm;

/**
 * Recursively collect markdown files under `root`, excluding dotfiles and
 * node_modules by default. Directories whose name starts with `.` or matches
 * `node_modules` are skipped.
 *
 * @param {string} root
 * @returns {string[]} absolute paths
 */
function collectMarkdownFiles(root) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(root)) return out;

  /**
   * @param {string} dir
   */
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
        walk(full);
      } else if (ent.isFile() && MARKDOWN_EXTENSIONS.has(extname(ent.name))) {
        out.push(full);
      }
    }
  };

  try {
    const s = statSync(root);
    if (s.isDirectory()) walk(root);
    else if (s.isFile() && MARKDOWN_EXTENSIONS.has(extname(root))) out.push(root);
  } catch {
    /* root doesn't exist */
  }
  return out;
}

/**
 * Compute a GitHub-style anchor slug for `heading` (lowercase, non-alphanum → '-').
 * Mirrors what Nextra produces for `## My Heading` -> `#my-heading`.
 *
 * @param {string} heading
 */
function anchorSlug(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Collect heading slug set for `path` if it's a markdown file under one of the search roots.
 *
 * @param {string} path
 */
function collectAnchors(path) {
  if (!existsSync(path)) return null;
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  /** @type {Set<string>} */
  const slugs = new Set();
  let m;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(content))) {
    slugs.add(anchorSlug(m[2]));
  }
  return slugs;
}

/**
 * Resolve a relative href from `fromFile`. The candidate path is computed
 * once as an absolute filesystem path; `existsSync` checks the disk directly,
 * so relative links across `docs/` and `packages/docs/` resolve as long as
 * the target exists anywhere in the repo.
 *
 * @param {string} href
 * @param {string} fromFile
 */
function resolveLink(href, fromFile) {
  if (!href || href.startsWith('#')) return null; // intra-file anchor — skip
  if (/^[a-z]+:\/\//i.test(href)) return null; // http(s)://, mailto:, etc.
  if (isAbsolute(href)) return null; // absolute fs path — out of scope

  // Split off anchor.
  const [pathPart, anchorPart] = href.split('#');
  // Normalize paths like `./foo` and `foo/bar`.
  const baseDir = dirname(fromFile);

  const candidates = [resolve(baseDir, pathPart)];
  if (!extname(pathPart)) {
    candidates.push(resolve(baseDir, pathPart + '.md'));
    candidates.push(resolve(baseDir, pathPart + '.mdx'));
    candidates.push(resolve(baseDir, pathPart, 'index.md'));
    candidates.push(resolve(baseDir, pathPart, 'index.mdx'));
  }
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) {
      if (anchorPart) {
        const slugs = collectAnchors(c);
        if (slugs && !slugs.has(anchorPart)) {
          return {
            ok: false,
            resolved: relative(DOCS_ROOT, c),
            reason: `missing anchor "#${anchorPart}"`,
          };
        }
      }
      return { ok: true, resolved: relative(DOCS_ROOT, c) };
    }
  }
  return {
    ok: false,
    resolved: relative(DOCS_ROOT, baseDir),
    reason: 'target file does not exist',
  };
}

/** Main entrypoint. */
function main() {
  const files = SEARCH_ROOTS.flatMap((r) => collectMarkdownFiles(r));
  /** @type {{file: string, text: string, href: string, reason: string}[]} */
  const broken = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(content))) {
      const { text, href } = m.groups;
      const r = resolveLink(href, file);
      if (r && !r.ok) {
        broken.push({
          file: relative(DOCS_ROOT, file),
          text,
          href,
          reason: r.reason,
        });
      }
    }
  }

  if (broken.length === 0) {
    console.log(
      `✓ internal-link-check: ${files.length} markdown file${
        files.length === 1 ? '' : 's'
      } scanned, 0 broken links.`
    );
    process.exit(0);
  }

  console.error(
    `✗ internal-link-check: found ${broken.length} broken link${broken.length === 1 ? '' : 's'}:`
  );
  for (const b of broken) {
    console.error(`  ${b.file}: [${b.text}](${b.href}) — ${b.reason}`);
  }
  process.exit(1);
}

main();
