/**
 * scripts/lib/docs-nav.mjs
 *
 * Parse validation for the canonical docs navigation (#1284).
 *
 * The canonical site (`packages/docs/`, Nextra 4) builds its sidebar from
 * `_meta.ts` modules under `packages/docs/content/`. Those are TypeScript,
 * so the legacy JSON checker (`scripts/check-meta-nav.mjs`) cannot read them,
 * and a typo only surfaces as a broken or silently missing sidebar entry
 * after deploy.
 *
 * This module parses the restricted subset of TypeScript a `_meta.ts` file is
 * allowed to use — without executing it and without dependencies, so it runs
 * in CI before `pnpm install`:
 *
 *   import name from './relative/_meta';          (default imports, for spreads)
 *   import type { MetaRecord } from 'nextra';     (type-only imports, ignored)
 *   export default { key: 'Title', other: { title: 'T', type: 'page' }, ...name }
 *     [as const | satisfies MetaRecord] [;]
 *
 * Anything else is a parse error with file:line:col (fail closed). The parsed
 * entries are then validated against Nextra's `_meta` schema and the file
 * tree: unknown fields, bad enum values, empty titles, duplicate keys,
 * orphaned entries and undiscoverable pages are all reported.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

export const META_FILENAMES = ['_meta.ts', '_meta.js'];
const PAGE_EXTENSIONS = new Set(['.md', '.mdx']);
const IMPORT_EXTENSIONS = ['.ts', '.js', '.mjs'];

const ALLOWED_FIELDS = new Set(['title', 'type', 'display', 'href', 'theme', 'items', 'newWindow']);
const ALLOWED_TYPES = new Set(['page', 'doc', 'separator', 'menu']);
const ALLOWED_DISPLAY = new Set(['normal', 'hidden', 'children']);

export class MetaParseError extends Error {
  constructor(message, file, line, col) {
    super(`${file}:${line}:${col} ${message}`);
    this.name = 'MetaParseError';
    this.file = file;
    this.line = line;
    this.col = col;
    this.reason = message;
  }
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

function tokenize(source, file) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (source[i] === '\n') {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
      i += 1;
    }
  };
  const fail = (message) => {
    throw new MetaParseError(message, file, line, col);
  };

  while (i < source.length) {
    const ch = source[i];

    if (/\s/.test(ch)) {
      advance();
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') advance();
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      advance(2);
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) advance();
      if (i >= source.length) fail('unterminated block comment');
      advance(2);
      continue;
    }

    const start = { line, col };

    if (ch === "'" || ch === '"') {
      const quote = ch;
      advance();
      let value = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\n') fail('unterminated string literal');
        if (source[i] === '\\') {
          advance();
          const esc = source[i];
          const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' };
          if (!(esc in map)) fail(`unsupported escape sequence \\${esc}`);
          value += map[esc];
          advance();
          continue;
        }
        value += source[i];
        advance();
      }
      if (i >= source.length) fail('unterminated string literal');
      advance();
      tokens.push({ type: 'string', value, ...start });
      continue;
    }

    if (ch === '`') fail('template literals are not allowed in _meta files');

    if (/[A-Za-z_$]/.test(ch)) {
      let value = '';
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) {
        value += source[i];
        advance();
      }
      tokens.push({ type: 'ident', value, ...start });
      continue;
    }

    if (/[0-9-]/.test(ch)) {
      let value = '';
      while (i < source.length && /[0-9.\-]/.test(source[i])) {
        value += source[i];
        advance();
      }
      if (!/^-?\d+(\.\d+)?$/.test(value)) fail(`invalid number "${value}"`);
      tokens.push({ type: 'number', value: Number(value), ...start });
      continue;
    }

    if (source.startsWith('...', i)) {
      tokens.push({ type: 'punct', value: '...', ...start });
      advance(3);
      continue;
    }

    if ('{}:,;'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch, ...start });
      advance();
      continue;
    }

    fail(`unexpected character "${ch}"`);
  }

  tokens.push({ type: 'eof', value: null, line, col });
  return tokens;
}

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse `_meta` module source into `{ imports, value }` where `value` is the
 * default-exported object as an AST:
 *   { kind: 'object', members: [{ kind: 'entry', key, value, line, col } |
 *                               { kind: 'spread', name, line, col }] }
 */
export function parseMetaSource(source, file = '<memory>') {
  const tokens = tokenize(source, file);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const fail = (token, message) => {
    throw new MetaParseError(message, file, token.line, token.col);
  };
  const describe = (token) => (token.type === 'eof' ? 'end of file' : `"${token.value}"`);
  const expectPunct = (value) => {
    const token = next();
    if (token.type !== 'punct' || token.value !== value) {
      fail(token, `expected "${value}" but found ${describe(token)}`);
    }
    return token;
  };
  const expectIdent = (value) => {
    const token = next();
    if (token.type !== 'ident' || (value && token.value !== value)) {
      fail(
        token,
        `expected ${value ? `"${value}"` : 'an identifier'} but found ${describe(token)}`
      );
    }
    return token;
  };
  const isPunct = (value) => peek().type === 'punct' && peek().value === value;
  const isIdent = (value) => peek().type === 'ident' && peek().value === value;
  const skipSemicolon = () => {
    if (isPunct(';')) next();
  };

  const imports = new Map();

  while (isIdent('import')) {
    next();
    if (isIdent('type')) {
      next();
      expectPunct('{');
      while (!isPunct('}')) {
        expectIdent();
        if (isPunct(',')) next();
        else break;
      }
      expectPunct('}');
      expectIdent('from');
      const spec = next();
      if (spec.type !== 'string') fail(spec, 'expected a module specifier string');
      skipSemicolon();
      continue;
    }
    const name = expectIdent();
    expectIdent('from');
    const spec = next();
    if (spec.type !== 'string') fail(spec, 'expected a module specifier string');
    if (!spec.value.startsWith('./') && !spec.value.startsWith('../')) {
      fail(spec, `only relative imports are allowed in _meta files (got "${spec.value}")`);
    }
    if (imports.has(name.value)) fail(name, `duplicate import "${name.value}"`);
    imports.set(name.value, { spec: spec.value, line: name.line, col: name.col });
    skipSemicolon();
  }

  const exportToken = peek();
  if (!isIdent('export')) {
    fail(exportToken, `expected "export default" but found ${describe(exportToken)}`);
  }
  next();
  expectIdent('default');

  function parseValue() {
    const token = peek();
    if (token.type === 'string' || token.type === 'number') {
      next();
      return { kind: 'literal', value: token.value, line: token.line, col: token.col };
    }
    if (token.type === 'ident' && ['true', 'false', 'null'].includes(token.value)) {
      next();
      const value = token.value === 'null' ? null : token.value === 'true';
      return { kind: 'literal', value, line: token.line, col: token.col };
    }
    if (isPunct('{')) return parseObject();
    fail(token, `expected a string, number, boolean or object but found ${describe(token)}`);
  }

  function parseObject() {
    const open = expectPunct('{');
    const members = [];
    while (!isPunct('}')) {
      const token = peek();
      if (isPunct('...')) {
        next();
        const name = expectIdent();
        members.push({ kind: 'spread', name: name.value, line: token.line, col: token.col });
      } else if (token.type === 'ident' || token.type === 'string') {
        next();
        expectPunct(':');
        const value = parseValue();
        members.push({ kind: 'entry', key: token.value, value, line: token.line, col: token.col });
      } else {
        fail(token, `expected a property key but found ${describe(token)}`);
      }
      if (isPunct(',')) next();
      else if (!isPunct('}')) fail(peek(), `expected "," or "}" but found ${describe(peek())}`);
    }
    expectPunct('}');
    return { kind: 'object', members, line: open.line, col: open.col };
  }

  const value = parseValue();
  if (value.kind !== 'object') fail(exportToken, 'the default export must be an object literal');

  if (isIdent('as')) {
    next();
    expectIdent('const');
  } else if (isIdent('satisfies')) {
    next();
    expectIdent();
  }
  skipSemicolon();

  if (peek().type !== 'eof') {
    fail(peek(), `unexpected ${describe(peek())} after the default export`);
  }

  return { imports, value };
}

/** Convert a literal/object AST node to a plain JS value (spreads excluded). */
function toPlain(node) {
  if (node.kind === 'literal') return node.value;
  const out = {};
  for (const member of node.members) {
    if (member.kind === 'entry') out[member.key] = toPlain(member.value);
  }
  return out;
}

function resolveImport(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, ...IMPORT_EXTENSIONS.map((ext) => base + ext)];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

/**
 * Read and parse a `_meta` file, inlining `...spread` members from relative
 * imports. Returns `{ entries: [{ key, value, node, file, line, col }], errors }`.
 */
export function loadMetaFile(file, stack = []) {
  const errors = [];
  const entries = [];

  if (stack.includes(file)) {
    errors.push({ file, line: 1, col: 1, kind: 'parse', message: 'circular _meta import' });
    return { entries, errors };
  }

  let parsed;
  try {
    parsed = parseMetaSource(readFileSync(file, 'utf8'), file);
  } catch (err) {
    if (!(err instanceof MetaParseError)) throw err;
    errors.push({ file, line: err.line, col: err.col, kind: 'parse', message: err.reason });
    return { entries, errors };
  }

  for (const member of parsed.value.members) {
    if (member.kind === 'entry') {
      entries.push({
        key: member.key,
        value: toPlain(member.value),
        node: member.value,
        file,
        line: member.line,
        col: member.col,
      });
      continue;
    }

    const imported = parsed.imports.get(member.name);
    if (!imported) {
      errors.push({
        file,
        line: member.line,
        col: member.col,
        kind: 'parse',
        message: `spread of "${member.name}" which is not a default import`,
      });
      continue;
    }
    const target = resolveImport(file, imported.spec);
    if (!target) {
      errors.push({
        file,
        line: imported.line,
        col: imported.col,
        kind: 'parse',
        message: `cannot resolve import "${imported.spec}"`,
      });
      continue;
    }
    const child = loadMetaFile(target, [...stack, file]);
    errors.push(...child.errors);
    entries.push(...child.entries);
  }

  return { entries, errors };
}

// ── File tree ────────────────────────────────────────────────────────────────

export function findMetaFile(dir) {
  for (const name of META_FILENAMES) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function containsPages(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (containsPages(full)) return true;
    } else if (PAGE_EXTENSIONS.has(extname(entry))) {
      return true;
    }
  }
  return false;
}

/** Keys Nextra would derive for `dir`: page stems and directories holding pages. */
export function navigableKeys(dir) {
  const keys = new Set();
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (containsPages(full)) keys.add(entry);
    } else if (PAGE_EXTENSIONS.has(extname(entry))) {
      keys.add(basename(entry, extname(entry)));
    }
  }
  return keys;
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateEntryValue(entry, push) {
  const { key, value, node } = entry;

  if (typeof value === 'string') {
    if (!value.trim()) push(entry, `"${key}" has an empty title`);
    return;
  }
  if (node.kind !== 'object') {
    push(entry, `"${key}" must be a title string or an object, got ${JSON.stringify(value)}`);
    return;
  }

  for (const field of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(field)) {
      push(entry, `"${key}" has unknown field "${field}"`);
    }
  }
  if ('title' in value && (typeof value.title !== 'string' || !value.title.trim())) {
    push(entry, `"${key}".title must be a non-empty string`);
  }
  if ('type' in value && !ALLOWED_TYPES.has(value.type)) {
    push(entry, `"${key}".type must be one of ${[...ALLOWED_TYPES].join(', ')}`);
  }
  if ('display' in value && !ALLOWED_DISPLAY.has(value.display)) {
    push(entry, `"${key}".display must be one of ${[...ALLOWED_DISPLAY].join(', ')}`);
  }
  if ('href' in value && (typeof value.href !== 'string' || !value.href.trim())) {
    push(entry, `"${key}".href must be a non-empty string`);
  }
  for (const field of ['theme', 'items']) {
    if (field in value && (typeof value[field] !== 'object' || value[field] === null)) {
      push(entry, `"${key}".${field} must be an object`);
    }
  }
}

/** Entries that do not have to be backed by a page or directory. */
function isVirtualEntry(entry) {
  const { key, value } = entry;
  if (key === '*') return true;
  if (value && typeof value === 'object') {
    return value.type === 'separator' || typeof value.href === 'string' || value.type === 'menu';
  }
  return false;
}

/**
 * Validate one directory's `_meta` against Nextra's schema and the file tree.
 * Returns `{ keys, entries, errors }`.
 */
export function validateMetaDir(dir, metaFile = findMetaFile(dir)) {
  const errors = [];
  if (!metaFile) return { keys: new Set(), entries: [], errors };

  const loaded = loadMetaFile(metaFile);
  errors.push(...loaded.errors);

  const push = (entry, message, kind = 'schema') =>
    errors.push({ file: entry.file, line: entry.line, col: entry.col, kind, message });

  const seen = new Map();
  for (const entry of loaded.entries) {
    if (seen.has(entry.key)) {
      const first = seen.get(entry.key);
      push(
        entry,
        `duplicate key "${entry.key}" (first declared at ${
          relative(dir, first.file) || first.file
        }:${first.line}); the earlier entry would be silently dropped`,
        'duplicate'
      );
      continue;
    }
    seen.set(entry.key, entry);
    validateEntryValue(entry, push);
  }

  const navigable = navigableKeys(dir);
  for (const entry of seen.values()) {
    if (isVirtualEntry(entry)) continue;
    if (!navigable.has(entry.key)) {
      push(entry, `"${entry.key}" has no matching page or directory`, 'orphaned');
    }
  }
  if (loaded.errors.length === 0) {
    for (const key of navigable) {
      if (!seen.has(key)) {
        errors.push({
          file: metaFile,
          line: 1,
          col: 1,
          kind: 'undiscoverable',
          message: `"${key}" exists but is not declared in ${basename(metaFile)}`,
        });
      }
    }
  }

  return { keys: new Set(seen.keys()), entries: [...seen.values()], errors };
}

/**
 * Validate every `_meta` file under the canonical content root.
 * Returns `{ metaFiles, entries, errors }`; `errors` empty means valid.
 */
export function validateContentTree(contentRoot) {
  const report = { metaFiles: 0, entries: 0, errors: [] };

  if (!existsSync(contentRoot) || !statSync(contentRoot).isDirectory()) {
    report.errors.push({
      file: contentRoot,
      line: 1,
      col: 1,
      kind: 'parse',
      message: 'content directory not found',
    });
    return report;
  }

  const walk = (dir) => {
    if (existsSync(join(dir, '_meta.json'))) {
      report.errors.push({
        file: join(dir, '_meta.json'),
        line: 1,
        col: 1,
        kind: 'schema',
        message: 'Nextra 4 ignores _meta.json; convert it to _meta.ts',
      });
    }
    const metaFile = findMetaFile(dir);
    if (metaFile) {
      const result = validateMetaDir(dir, metaFile);
      report.metaFiles += 1;
      report.entries += result.entries.length;
      report.errors.push(...result.errors);
    }
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
    }
  };

  walk(contentRoot);
  return report;
}

/**
 * True when `pagePath` (an .md/.mdx file under `contentRoot`) is declared at
 * every level of the canonical navigation. A directory without a `_meta`
 * file falls back to Nextra's automatic listing, so it counts as declared.
 */
export function isRegisteredInNav(contentRoot, pagePath) {
  const rel = relative(contentRoot, pagePath);
  if (rel.startsWith('..')) return false;

  const parts = rel.split(/[\\/]/);
  const last = parts.pop();
  const segments = [...parts, basename(last, extname(last))];

  let dir = contentRoot;
  for (const segment of segments) {
    const metaFile = findMetaFile(dir);
    if (metaFile) {
      const { entries, errors } = loadMetaFile(metaFile);
      if (errors.length > 0) return false;
      if (!entries.some((entry) => entry.key === segment)) return false;
    }
    dir = join(dir, segment);
  }
  return true;
}

export function formatError(error, root) {
  const file = root ? relative(root, error.file) || error.file : error.file;
  return `${file}:${error.line}:${error.col} [${error.kind}] ${error.message}`;
}
