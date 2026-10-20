/**
 * scripts/lib/workflow-policy.mjs
 *
 * GitHub Actions policy and CI/CD documentation checks (#1286).
 *
 * docs/ci-cd.md stated two supply-chain controls as facts — "every workflow
 * file sets a top-level permissions: block" and "every third-party action is
 * pinned to a full 40-character commit SHA" — and neither held: three
 * workflows had no permissions block and seven third-party actions were on
 * mutable tags, one of them a tag that does not exist. It also documented a
 * workflow that does not exist and left 25 of 53 undocumented. This module
 * enforces the controls and keeps the document generated from, and checked
 * against, the workflow files:
 *
 *   - permissions:   every workflow declares top-level `permissions:` and
 *                    never `write-all`;
 *   - pinning:       every third-party `uses:` (workflows and composite
 *                    actions) is a 40-hex commit SHA with a `# version`
 *                    comment, unless listed in .github/workflow-policy.json
 *                    with a reason — and a listed exemption that no longer
 *                    matches a real `uses:` is itself a failure;
 *   - inventory:     the table between `<!-- workflows:begin/end -->` in
 *                    docs/ci-cd.md equals what the workflow files declare
 *                    (regenerate with `--write`);
 *   - pinned table:  the "Currently pinned third-party actions" table lists
 *                    exactly the third-party actions in use, with their
 *                    versions;
 *   - references:    every `*.yml` workflow the document names exists.
 *
 * Dependency-free: plain Node. It reads only the top-level structure of each
 * workflow (`on`, `permissions`, `concurrency`) and `uses:` lines; syntax and
 * expression validity are actionlint's job (run alongside in CI).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const RULES = {
  PARSE: 'workflow-unreadable',
  PERMISSIONS: 'permissions-missing',
  WRITE_ALL: 'permissions-write-all',
  UNPINNED: 'action-unpinned',
  NO_VERSION: 'pin-without-version',
  EXEMPTION: 'exemption-invalid',
  STALE_EXEMPTION: 'exemption-stale',
  INVENTORY: 'inventory-drift',
  PINNED_TABLE: 'pinned-table-drift',
  DEAD_REFERENCE: 'dead-workflow-reference',
  PORT: 'port-drift',
};

export const DOC = 'docs/ci-cd.md';
export const PORT = 'packages/docs/content/ci-cd.mdx';
export const POLICY_FILE = '.github/workflow-policy.json';
const WORKFLOW_DIR = '.github/workflows';
const ACTIONS_DIR = '.github/actions';

/** Publishers whose actions are trusted on major-version tags (GitHub's own). */
export const FIRST_PARTY = ['actions'];

const SHA = /^[0-9a-f]{40}$/;

// ── Workflow reading ─────────────────────────────────────────────────────────

const stripComment = (value) => value.replace(/\s+#.*$/, '').trim();
const unquote = (value) => value.replace(/^(['"])(.*)\1$/, '$2');

/**
 * Top-level `key: value` blocks of a YAML document: { key: { inline, lines } }.
 * `inline` is the text after the colon; `lines` are the indented lines below.
 */
export function topLevelBlocks(text) {
  const blocks = {};
  let current = null;
  text.split('\n').forEach((raw, i) => {
    if (/^\s*(#.*)?$/.test(raw)) return;
    const top = /^(['"]?)([A-Za-z_][\w-]*)\1:\s*(.*)$/.exec(raw);
    if (top && !/^\s/.test(raw)) {
      current = { inline: stripComment(top[3]), lines: [], line: i + 1 };
      blocks[top[2]] = current;
    } else if (current && /^\s/.test(raw)) {
      current.lines.push(raw);
    } else if (!/^\s/.test(raw) && !raw.startsWith('-') && !raw.startsWith('---')) {
      throw new Error(`line ${i + 1}: cannot read top-level structure: ${raw.trim().slice(0, 60)}`);
    }
  });
  return blocks;
}

/** The immediate children of a block, at its first indentation level. */
function childEntries(lines) {
  const first = lines.find((l) => l.trim() && !l.trim().startsWith('#'));
  if (!first) return [];
  const indent = first.length - first.trimStart().length;
  const out = [];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const lead = line.length - line.trimStart().length;
    if (lead !== indent) continue;
    const body = line.trim();
    const list = /^-\s+(.*)$/.exec(body);
    if (list) {
      out.push({ key: unquote(stripComment(list[1])), value: null });
      continue;
    }
    const kv = /^(['"]?)([^:'"]+)\1:\s*(.*)$/.exec(body);
    if (kv) out.push({ key: kv[2].trim(), value: unquote(stripComment(kv[3])) });
  }
  return out;
}

function flowList(inline) {
  const m = /^\[(.*)\]$/.exec(inline);
  if (m)
    return m[1]
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
  const map = /^\{(.*)\}$/.exec(inline);
  if (map) {
    return map[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((pair) => {
        const [k, ...v] = pair.split(':');
        return { key: unquote(k.trim()), value: unquote(v.join(':').trim()) };
      });
  }
  return null;
}

/**
 * The parts of a workflow the policy and the inventory need.
 * Throws on a file whose top-level structure cannot be read.
 */
export function parseWorkflow(text) {
  const blocks = topLevelBlocks(text);

  // Triggers. YAML 1.1 reads a bare `on` as boolean true in some parsers;
  // GitHub (and this reader) treat it as the key.
  const on = blocks.on ?? blocks.true;
  let triggers = [];
  if (on) {
    if (on.inline) {
      const list = flowList(on.inline);
      triggers = list ? list.map((x) => (typeof x === 'string' ? x : x.key)) : [unquote(on.inline)];
    } else {
      triggers = childEntries(on.lines).map((e) => e.key);
    }
  }

  // Permissions: absent | 'read-all' | 'write-all' | {} | [{key, value}].
  let permissions;
  const perm = blocks.permissions;
  if (!perm) permissions = undefined;
  else if (perm.inline) {
    const flow = flowList(perm.inline);
    permissions = flow ?? unquote(perm.inline);
  } else permissions = childEntries(perm.lines);

  // Concurrency: absent | {group, cancel}.
  let concurrency;
  const conc = blocks.concurrency;
  if (conc) {
    if (conc.inline) concurrency = { group: unquote(conc.inline), cancel: false };
    else {
      const entries = Object.fromEntries(childEntries(conc.lines).map((e) => [e.key, e.value]));
      const cancel = entries['cancel-in-progress'];
      concurrency = {
        group: entries.group ?? '',
        cancel:
          cancel === 'true'
            ? true
            : cancel === undefined || cancel === 'false'
            ? false
            : 'expression',
      };
    }
  }

  return {
    name: blocks.name ? unquote(blocks.name.inline) : null,
    triggers,
    permissions,
    concurrency,
    uses: usesRefs(text),
  };
}

/** Every `uses:` reference, with its line and trailing comment. */
export function usesRefs(text) {
  const refs = [];
  text.split('\n').forEach((line, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*(['"]?)([^'"\s#]+)\1\s*(?:#\s*(.*))?$/.exec(line);
    if (m) refs.push({ ref: m[2], comment: (m[3] ?? '').trim(), line: i + 1 });
  });
  return refs;
}

/** { action, version } for a third-party reference, or null when local/first-party. */
export function classifyUses(ref) {
  if (ref.startsWith('./') || ref.startsWith('../')) return null;
  if (ref.startsWith('docker://')) return { action: ref, version: null, docker: true };
  const at = ref.lastIndexOf('@');
  if (at < 0) return { action: ref, version: '' };
  const action = ref.slice(0, at);
  const owner = action.split('/')[0];
  if (FIRST_PARTY.includes(owner)) return null;
  return { action, version: ref.slice(at + 1) };
}

// ── Rendering the inventory ──────────────────────────────────────────────────

export function describePermissions(permissions) {
  if (permissions === undefined) return '**missing**';
  if (typeof permissions === 'string') return `\`${permissions}\``;
  if (permissions.length === 0) return '`{}` (none)';
  return permissions.map((p) => `\`${p.key}: ${p.value}\``).join(', ');
}

export function describeConcurrency(concurrency) {
  if (!concurrency) return '—';
  if (concurrency.cancel === true) return 'cancel superseded';
  if (concurrency.cancel === 'expression') return 'conditional';
  return 'queue';
}

/** One inventory row per workflow, sorted by file name. */
export function inventoryRows(workflows) {
  return workflows
    .filter((w) => w.parsed)
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(
      (w) =>
        `| [\`${w.file}\`](../.github/workflows/${w.file}) | ${
          w.parsed.triggers.map((t) => `\`${t}\``).join(', ') || '—'
        } | ` +
        `${describePermissions(w.parsed.permissions)} | ${describeConcurrency(
          w.parsed.concurrency
        )} |`
    );
}

export const INVENTORY_HEADER = [
  '| Workflow | Triggers | Top-level permissions | Concurrency |',
  '| -------- | -------- | --------------------- | ----------- |',
];

/** Replace the inventory between the markers (both comment forms). Returns the new text. */
export function writeInventory(markdown, rows, { mdx = false } = {}) {
  const begin = mdx ? '{/* workflows:begin */}' : '<!-- workflows:begin -->';
  const end = mdx ? '{/* workflows:end */}' : '<!-- workflows:end -->';
  const from = markdown.indexOf(begin);
  const to = markdown.indexOf(end);
  if (from < 0 || to < from) throw new Error(`inventory markers ${begin} … ${end} not found`);
  const body = [...INVENTORY_HEADER, ...rows].join('\n');
  return `${markdown.slice(0, from + begin.length)}\n${body}\n${markdown.slice(to)}`;
}

export function readInventory(markdown) {
  const m =
    /(?:<!-- workflows:begin -->|\{\/\* workflows:begin \*\/\})\n([\s\S]*?)\n(?:<!-- workflows:end -->|\{\/\* workflows:end \*\/\})/.exec(
      markdown
    );
  if (!m) return null;
  return m[1]
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .slice(INVENTORY_HEADER.length);
}

// ── Loading ──────────────────────────────────────────────────────────────────

export function loadWorkflows(root) {
  const dir = join(root, WORKFLOW_DIR);
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /\.ya?ml$/.test(f))
        .sort()
    : [];
  return files.map((file) => {
    const path = `${WORKFLOW_DIR}/${file}`;
    const text = readFileSync(join(root, path), 'utf8');
    try {
      return { file, path, text, parsed: parseWorkflow(text) };
    } catch (err) {
      return { file, path, text, parsed: null, error: err.message };
    }
  });
}

export function loadCompositeActions(root) {
  const dir = join(root, ACTIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) =>
      ['action.yml', 'action.yaml']
        .map((f) => `${ACTIONS_DIR}/${name}/${f}`)
        .find((p) => existsSync(join(root, p)))
    )
    .filter(Boolean)
    .map((path) => ({ path, uses: usesRefs(readFileSync(join(root, path), 'utf8')) }));
}

export function loadPolicy(root) {
  const path = join(root, POLICY_FILE);
  if (!existsSync(path)) return { exemptions: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ── Checks ───────────────────────────────────────────────────────────────────

export function checkWorkflowPolicy(root) {
  const findings = [];
  const report = (rule, file, line, message) => findings.push({ rule, file, line, message });

  const workflows = loadWorkflows(root);
  const composites = loadCompositeActions(root);
  let policy;
  try {
    policy = loadPolicy(root);
  } catch (err) {
    report(RULES.EXEMPTION, POLICY_FILE, 0, `cannot parse: ${err.message}`);
    policy = { exemptions: [] };
  }

  // Exemptions must be explicit, reasoned, and pinned to an immutable-by-
  // convention release tag (vX.Y.Z), never a branch.
  const exemptions = new Map();
  for (const [i, e] of (policy.exemptions ?? []).entries()) {
    const where = `exemptions[${i}]`;
    if (!e || typeof e.uses !== 'string' || !e.uses.includes('@')) {
      report(RULES.EXEMPTION, POLICY_FILE, 0, `${where}: "uses" must be an exact owner/repo@ref`);
      continue;
    }
    if (typeof e.reason !== 'string' || e.reason.trim().length < 20) {
      report(
        RULES.EXEMPTION,
        POLICY_FILE,
        0,
        `${where}: a reason (at least 20 characters) is required`
      );
    }
    const ref = e.uses.slice(e.uses.lastIndexOf('@') + 1);
    if (!/^v\d+\.\d+\.\d+$/.test(ref)) {
      report(
        RULES.EXEMPTION,
        POLICY_FILE,
        0,
        `${where}: exempt references must be a full release tag (vX.Y.Z), got "${ref}"`
      );
    }
    exemptions.set(e.uses, { ...e, used: false });
  }

  const thirdParty = new Map(); // action → { versions:Set, shas:Set }
  const checkUses = (path, refs) => {
    for (const { ref, comment, line } of refs) {
      const c = classifyUses(ref);
      if (!c) continue;
      const exemption = exemptions.get(ref);
      if (exemption) {
        exemption.used = true;
        continue;
      }
      if (c.docker) {
        if (!/@sha256:[0-9a-f]{64}$/.test(ref))
          report(RULES.UNPINNED, path, line, `${ref} must be pinned by @sha256 digest`);
        continue;
      }
      if (!SHA.test(c.version)) {
        report(RULES.UNPINNED, path, line, `${ref} is not pinned to a 40-character commit SHA`);
        continue;
      }
      const version = comment.split(/\s+/)[0] ?? '';
      if (!version)
        report(
          RULES.NO_VERSION,
          path,
          line,
          `${c.action}@${c.version.slice(0, 7)}… needs a "# <version>" comment`
        );
      const entry = thirdParty.get(c.action) ?? { versions: new Set(), shas: new Set() };
      if (version) entry.versions.add(version);
      entry.shas.add(c.version);
      thirdParty.set(c.action, entry);
    }
  };

  for (const w of workflows) {
    if (!w.parsed) {
      report(RULES.PARSE, w.path, 0, w.error);
      continue;
    }
    const p = w.parsed.permissions;
    const line = w.text.split('\n').findIndex((l) => /^permissions:/.test(l)) + 1;
    if (p === undefined) report(RULES.PERMISSIONS, w.path, 0, 'no top-level `permissions:` block');
    else if (p === 'write-all')
      report(RULES.WRITE_ALL, w.path, line, '`permissions: write-all` grants every scope');
    checkUses(w.path, w.parsed.uses);
  }
  for (const a of composites) checkUses(a.path, a.uses);

  for (const [uses, e] of exemptions) {
    if (!e.used)
      report(
        RULES.STALE_EXEMPTION,
        POLICY_FILE,
        0,
        `"${uses}" is exempt but no workflow uses it — remove the exemption`
      );
  }

  // ── Documentation ─────────────────────────────────────────────────────────
  const docPath = join(root, DOC);
  let rows = 0;
  if (existsSync(docPath)) {
    const doc = readFileSync(docPath, 'utf8');
    const expected = inventoryRows(workflows);
    rows = expected.length;
    const actual = readInventory(doc);
    if (!actual) report(RULES.INVENTORY, DOC, 0, 'workflow inventory markers not found');
    else {
      const want = new Set(expected);
      const have = new Set(actual);
      for (const r of expected)
        if (!have.has(r)) report(RULES.INVENTORY, DOC, 0, `missing or outdated: ${r}`);
      for (const r of actual)
        if (!want.has(r)) report(RULES.INVENTORY, DOC, 0, `does not match a workflow file: ${r}`);
    }

    // Every workflow file the document names must exist.
    const names = new Set(workflows.map((w) => w.file));
    doc.split('\n').forEach((text, i) => {
      for (const m of text.matchAll(
        /`(?:\.github\/workflows\/)?([a-z0-9][\w.-]*\.ya?ml)(?:@[^`]*)?`/g
      )) {
        const name = m[1];
        if (
          name === 'action.yml' ||
          name === 'docker-compose.yml' ||
          name === 'pnpm-lock.yaml' ||
          name === 'actionlint.yaml'
        )
          continue;
        if (!names.has(name))
          report(
            RULES.DEAD_REFERENCE,
            DOC,
            i + 1,
            `\`${name}\` is not a workflow in ${WORKFLOW_DIR}/`
          );
      }
    });

    checkPinnedTable(doc, thirdParty, report);

    // The canonical-site port must carry the same inventory.
    const portPath = join(root, PORT);
    if (!existsSync(portPath)) report(RULES.PORT, PORT, 0, `canonical port of ${DOC} is missing`);
    else {
      // Link targets differ by design (relative in docs/, absolute on the site).
      const strip = (rows) => rows && rows.map((r) => r.replace(/\]\([^)]*\)/g, ']'));
      const portRows = readInventory(readFileSync(portPath, 'utf8'));
      if (JSON.stringify(strip(portRows)) !== JSON.stringify(strip(actual))) {
        report(RULES.PORT, PORT, 0, `workflow inventory differs from ${DOC}; re-port it`);
      }
    }
  } else {
    report(RULES.INVENTORY, DOC, 0, 'CI/CD reference not found');
  }

  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  return {
    findings,
    workflows,
    summary: {
      ok: findings.length === 0,
      total: findings.length,
      byRule,
      workflows: workflows.length,
      compositeActions: composites.length,
      thirdPartyActions: thirdParty.size,
      exemptions: exemptions.size,
      inventoryRows: rows,
    },
  };
}

/**
 * The "Currently pinned third-party actions" table: one row per action in
 * use, each listing every version comment in use and any short SHA quoted
 * being a prefix of a real pin.
 */
function checkPinnedTable(doc, thirdParty, report) {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => /Currently pinned third-party actions/.test(l));
  if (start < 0) {
    report(RULES.PINNED_TABLE, DOC, 0, '"Currently pinned third-party actions" table not found');
    return;
  }
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) {
      if (rows.length) break;
      continue;
    }
    if (!l.startsWith('|')) break;
    const cells = l
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c)) || cells[0] === 'Action') continue;
    rows.push({ cells, line: i + 1 });
  }
  const documented = new Map();
  for (const row of rows) {
    const actions = [...row.cells[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const base = actions[0];
    if (!base) continue;
    // `github/codeql-action` (`init` + `analyze`) documents sub-actions.
    const subs = actions.slice(1).filter((a) => !a.includes('/'));
    const names = subs.length ? subs.map((s) => `${base}/${s}`) : [base];
    for (const name of names) documented.set(name, row);
  }
  for (const [action, used] of thirdParty) {
    const row = documented.get(action);
    if (!row) {
      report(
        RULES.PINNED_TABLE,
        DOC,
        start + 1,
        `${action} is used but not in the pinned-actions table`
      );
      continue;
    }
    const cell = row.cells.slice(1).join(' ');
    for (const v of used.versions) {
      if (!cell.includes(v))
        report(
          RULES.PINNED_TABLE,
          DOC,
          row.line,
          `${action}: version ${v} is in use but not listed`
        );
    }
    for (const m of cell.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
      if (![...used.shas].some((s) => s.startsWith(m[0]))) {
        report(RULES.PINNED_TABLE, DOC, row.line, `${action}: ${m[0]} is not the SHA in use`);
      }
    }
  }
  for (const [action, row] of documented) {
    if (!thirdParty.has(action))
      report(RULES.PINNED_TABLE, DOC, row.line, `${action} is listed but no workflow uses it`);
  }
}

export { basename };
