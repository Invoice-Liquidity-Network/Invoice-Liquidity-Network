import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, checkFile } from '../check-doc-links.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Docs Link Checker Suite (#1292)', () => {
  it('extracts markdown links correctly while ignoring code blocks', () => {
    const text = 'Here is a [link](https://example.com) and [internal](./audit.md).';
    const links = extractLinks(text);
    assert.deepEqual(links, ['https://example.com', './audit.md']);
  });

  it('skips external links when offline option is enabled', async () => {
    const tempFile = join(__dirname, 'mock-external-doc.md');
    const mockContent = 'Check [external](https://unreachable-domain-12345.org) and [repo](../../README.md)';
    writeFileSync(tempFile, mockContent, 'utf-8');

    try {
      const res = await checkFile(tempFile, process.cwd(), { offline: true });
      assert.equal(res.problems.length, 0);
    } finally {
      unlinkSync(tempFile);
    }
  });

  it('fails closed when internal relative link is broken', async () => {
    const tempFile = join(__dirname, 'mock-broken-internal-doc.md');
    const mockContent = 'Check [broken](./non-existent-page.md)';
    writeFileSync(tempFile, mockContent, 'utf-8');

    try {
      const res = await checkFile(tempFile, process.cwd(), { offline: true });
      assert.equal(res.problems.length, 1);
      assert.ok(res.problems[0].includes('missing'));
    } finally {
      unlinkSync(tempFile);
    }
  });
});
