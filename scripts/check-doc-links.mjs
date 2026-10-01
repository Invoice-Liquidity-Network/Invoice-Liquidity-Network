#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { readdir } from 'fs/promises';

function extractLinks(text) {
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  let m;
  while ((m = re.exec(text))) {
    links.push(m[2]);
  }
  return links;
}

async function checkFile(filePath, repoRoot) {
  const content = readFileSync(filePath, 'utf8');
  const links = extractLinks(content);
  const problems = [];

  await Promise.all(
    links.map(async (link) => {
      // ignore anchors only
      if (link.startsWith('#')) return;
      // strip title part: url "title"
      const url = link.split(/\s+/)[0];
      if (/^https?:\/\//i.test(url)) {
        try {
          const res = await fetch(url, { method: 'HEAD', redirect: 'follow', timeout: 5000 });
          if (!res.ok) problems.push(`external ${url} -> ${res.status}`);
        } catch (err) {
          problems.push(`external ${url} -> ${String(err)}`);
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
      const r = await checkFile(resolve(repoRoot, f), repoRoot);
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
