#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join, relative, sep } from 'path';
import { readdir } from 'fs/promises';
import { pathToFileURL } from 'url';

function extractLinks(text) {
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  let m;
  while ((m = re.exec(text))) {
    links.push(m[2]);
  }
  return links;
}

function resolveSiteRoute(route, contentRoot) {
  const routePath = resolve(contentRoot, `.${route}`);
  if (routePath !== contentRoot && !routePath.startsWith(`${contentRoot}${sep}`)) return null;

  const candidates = routePath === contentRoot
    ? [join(contentRoot, 'index.mdx'), join(contentRoot, 'index.md')]
    : [routePath, `${routePath}.mdx`, `${routePath}.md`, join(routePath, 'index.mdx'), join(routePath, 'index.md')];
  return candidates.find(existsSync) ?? null;
}

// HTTP statuses that say "the site would not answer this client right now",
// not "the page is gone": rate limiting and server errors. They are reported
// as warnings, like network failures, so a busy or bot-blocking site cannot
// fail an unrelated pull request. 404/410 and other client errors still fail.
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
// Some servers reject HEAD (405/501) or bot-like HEAD requests (403) while
// serving the page to GET; those are retried once with GET before judging.
const RETRY_WITH_GET = new Set([403, 405, 501]);

async function checkExternalLink(url, fetchImpl = fetch) {
  try {
    const request = (method) =>
      fetchImpl(url, { method, redirect: 'follow', signal: AbortSignal.timeout(5000) });
    let response = await request('HEAD');
    if (!response.ok && RETRY_WITH_GET.has(response.status)) response = await request('GET');
    if (response.ok) return { problem: null, warning: null };
    if (TRANSIENT_STATUSES.has(response.status)) {
      return {
        problem: null,
        warning: `external ${url} could not be verified: HTTP ${response.status} (transient)`,
      };
    }
    return { problem: `external ${url} -> ${response.status}`, warning: null };
  } catch (error) {
    // Network failures mean the link could not be verified; they do not prove
    // the destination is broken. Keep HTTP error responses as hard failures.
    return { problem: null, warning: `external ${url} could not be verified: ${String(error)}` };
  }
}

async function checkFile(filePath, repoRoot) {
  const content = readFileSync(filePath, 'utf8');
  // Fenced and inline code examples show markdown as text and should not be
  // checked as links from the file containing the example.
  const markdown = content
    .replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*(?:\n|$)/gm, '')
    .replace(/`[^`\n]*`/g, '');
  const links = extractLinks(markdown);
  const problems = [];
  const warnings = [];

  await Promise.all(
    links.map(async (link) => {
      // ignore anchors only
      if (link.startsWith('#')) return;
      // strip title part: url "title"
      const url = link.split(/\s+/)[0];
      if (/^https?:\/\//i.test(url)) {
        const result = await checkExternalLink(url);
        if (result.problem) problems.push(result.problem);
        if (result.warning) warnings.push(result.warning);
      } else {
        const localPath = url.split('#')[0];
        const contentRoot = resolve(repoRoot, 'packages/docs/content');
        const isSiteRoute = localPath.startsWith('/') && filePath.startsWith(`${contentRoot}${sep}`);
        const target = isSiteRoute
          ? resolveSiteRoute(localPath, contentRoot)
          : resolve(dirname(filePath), localPath);
        if (!target || !existsSync(target)) problems.push(`missing ${url}`);
      }
    })
  );

  return { file: filePath, problems, warnings };
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
      results.push({ file: f, problems: [`error ${String(err)}`], warnings: [] });
    }
  }

  let failed = 0;
  for (const r of results) {
    if (r.problems.length) {
      failed++;
      console.error(`\nProblems in ${r.file}:`);
      for (const p of r.problems) {
        console.error(` - ${p}`);
        // Surface each broken link as a GitHub annotation so it is visible on
        // the check run without opening the raw log.
        if (process.env.GITHUB_ACTIONS === 'true') {
          console.log(`::error file=${relative(repoRoot, r.file)}::${p.replace(/\r?\n/g, ' ')}`);
        }
      }
    }
    for (const warning of r.warnings ?? []) console.warn(`⚠️ ${r.file}: ${warning}`);
  }

  console.log(`\nChecked ${fileList.length} files, ${failed} files with problems.`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

export { checkExternalLink };
