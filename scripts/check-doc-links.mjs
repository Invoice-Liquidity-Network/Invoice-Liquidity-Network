#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { readdir } from 'fs/promises';

// `.github/markdown-link-check.json` is the one place the ignore list and the
// accepted status codes live, shared with anyone running markdown-link-check
// by hand. Honouring it here keeps a documented exception (mailto:, Nextra
// routes, hosts that 403 automated clients) from failing CI.
const CONFIG_PATH = '.github/markdown-link-check.json';

function loadConfig(repoRoot) {
  const path = resolve(repoRoot, CONFIG_PATH);
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const timeoutMatch = /^(\d+)(ms|s)?$/.exec(String(raw.timeout ?? '20s'));
  const timeoutMs = timeoutMatch
    ? Number(timeoutMatch[1]) * (timeoutMatch[2] === 'ms' ? 1 : 1000)
    : 20000;
  return {
    ignore: (raw.ignorePatterns ?? []).map((p) => new RegExp(p.pattern)),
    alive: new Set(raw.aliveStatusCodes ?? [200, 206, 301, 302]),
    retryOn429: raw.retryOn429 === true,
    retryCount: Number(raw.retryCount ?? 0),
    timeoutMs,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HEAD first (cheap), then GET for hosts that refuse HEAD (405) or gate it
// behind a browser check (403); a 429 is retried with backoff when the config
// asks for it.
async function fetchStatus(url, config) {
  const request = (method) =>
    fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(config.timeoutMs) });
  for (let attempt = 0; ; attempt++) {
    let res = await request('HEAD');
    if (!res.ok && !config.alive.has(res.status)) res = await request('GET');
    if (res.status === 429 && config.retryOn429 && attempt < config.retryCount) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    return res;
  }
}

function extractLinks(text) {
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  let m;
  // Code holds examples (sample nav files, templates, grep patterns), not
  // links the reader can follow; a Markdown parser skips fenced blocks and
  // inline spans and so do we.
  text = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
  while ((m = re.exec(text))) {
    links.push(m[2]);
  }
  return links;
}

async function checkFile(filePath, repoRoot, config) {
  const content = readFileSync(filePath, 'utf8');
  const links = extractLinks(content);
  const problems = [];

  await Promise.all(
    links.map(async (link) => {
      // ignore anchors only
      if (link.startsWith('#')) return;
      // strip title part: url "title"
      const url = link.split(/\s+/)[0];
      if (config.ignore.some((re) => re.test(url))) return;
      if (/^https?:\/\//i.test(url)) {
        try {
          const res = await fetchStatus(url, config);
          if (!res.ok && !config.alive.has(res.status))
            problems.push(`external ${url} -> ${res.status}`);
        } catch (err) {
          problems.push(
            `external ${url} -> ${err?.cause?.code ?? err?.cause?.message ?? String(err)}`
          );
        }
      } else {
        // local file
        const target = resolve(dirname(filePath), url.split('#')[0]);
        if (!existsSync(target)) problems.push(`missing ${url}`);
      }
    })
  );

  return { file: filePath, problems };
}

async function main() {
  const repoRoot = process.cwd();
  const config = loadConfig(repoRoot);
  const args = process.argv.slice(2);
  const targets = args.length ? args : ['docs/**/*.md', 'packages/docs/content/**/*.mdx', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'DEPLOYMENT_GUIDE.md', 'CHANGELOG.md'];

  // expand globs to files (supports simple patterns like 'dir/**/*.ext')
  async function walkDir(dir, ext) {
    const out = [];
    async function walk(d) {
      const entries = await readdir(d, { withFileTypes: true });
      for (const e of entries) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (ext == null || p.endsWith(ext)) out.push(p);
      }
    }
    await walk(dir);
    return out;
  }

  const files = new Set();
  for (const t of targets) {
    if (t.includes('**')) {
      // split 'base/**\/*.ext' -> base, ext
      const parts = t.split('**');
      const base = parts[0].replace(/\/$/, '') || '.';
      const extMatch = t.match(/\*\*\/(\*\.[^/]+)$/);
      const ext = extMatch ? extMatch[1].replace('*', '') : null;
      const matches = await walkDir(base, ext);
      matches.forEach((m) => files.add(m));
    } else if (t.includes('*')) {
      // simple pattern like '*.md'
      const dir = '.';
      const ext = t.replace('*', '');
      const matches = await walkDir(dir, ext);
      matches.forEach((m) => files.add(m));
    } else {
      files.add(t);
    }
  }

  const fileList = Array.from(files).sort();
  if (fileList.length === 0) {
    console.error('No files to check');
    process.exit(2);
  }

  console.log(`Checking ${fileList.length} files...`);

  const results = [];
  for (const f of fileList) {
    try {
      const r = await checkFile(resolve(repoRoot, f), repoRoot, config);
      results.push(r);
    } catch (err) {
      results.push({ file: f, problems: [`error ${String(err)}`] });
    }
  }

  let failed = 0;
  for (const r of results) {
    if (r.problems.length) {
      failed++;
      console.error(`\nProblems in ${r.file}:`);
      for (const p of r.problems) console.error(` - ${p}`);
    }
  }

  console.log(`\nChecked ${fileList.length} files, ${failed} files with problems.`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
