import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts/validate-mainnet-launch-evidence.mjs');
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainnet-evidence-'));
const checklistPath = path.join(fixtureDir, 'checklist.md');
const manifestPath = path.join(fixtureDir, 'audit.json');
const reportPath = path.join(fixtureDir, 'report.json');
const artifactBytes = Buffer.from('independent audit evidence fixture');
let server;
let artifactUrl;

const checklist = (artifact = 'artifact.txt', legacyApi = false) => `# Checklist\n\n| Item | Description | Owner | Status | Link | Verification artifact |\n| --- | --- | --- | --- | --- | --- |\n| Launch readiness | Verify launch control | Release lead | Not started | [Context](https://example.com/issue) | [Evidence](${artifact}) |\n${legacyApi ? '| API docs | Current API docs | SDK lead | Done | [Context](https://example.com) | [Legacy](api-collection.md) |\n' : ''}`;

function manifest(completedAt = '2026-10-19', digest = createHash('sha256').update(artifactBytes).digest('hex')) {
  return {
    status: 'complete',
    auditor: { name: 'Independent auditor', organization: 'Audit Firm', independent: true },
    completedAt,
    scope: ['contracts', 'upgrade-controls', 'sdk-signing', 'indexer-apis', 'notification-webhooks'],
    findings: { open: 0, accepted: 0, acceptanceRationale: '' },
    evidence: { url: artifactUrl, sha256: digest },
  };
}

function run({ launch = true, evidencePath = checklistPath, auditPath = manifestPath, report = reportPath, asOf = '2026-10-19' } = {}) {
  const args = [script, '--checklist', evidencePath, '--audit-manifest', auditPath, '--as-of', asOf, '--report', report];
  if (launch) args.push('--launch');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

before(async () => {
  fs.writeFileSync(path.join(fixtureDir, 'artifact.txt'), '# verification evidence\n');
  server = http.createServer((request, response) => {
    if (request.url === '/audit.pdf') {
      response.writeHead(200, { 'content-length': artifactBytes.length });
      response.end(artifactBytes);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  artifactUrl = `http://127.0.0.1:${server.address().port}/audit.pdf`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('mainnet launch evidence gate', () => {
  it('accepts current, verified audit evidence without requiring Done statuses', async () => {
    fs.writeFileSync(checklistPath, checklist());
    fs.writeFileSync(manifestPath, JSON.stringify(manifest()));
    const result = await run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.launchEligible, true);
    assert.equal(report.verifiedArtifactLinks, 1);
  });

  it('fails closed on missing audit dependencies, missing row evidence, and legacy API references', async () => {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest()));
    fs.writeFileSync(checklistPath, checklist('missing.txt'));
    const missingArtifact = await run();
    assert.equal(missingArtifact.status, 1);
    assert.match(missingArtifact.stdout, /verification artifact does not exist/);

    fs.writeFileSync(checklistPath, checklist('artifact.txt', true));
    const legacyReference = await run();
    assert.equal(legacyReference.status, 1);
    assert.match(legacyReference.stdout, /Legacy API documentation reference/);

    const missingManifest = await run({ auditPath: path.join(fixtureDir, 'absent-audit.json') });
    assert.equal(missingManifest.status, 1);
    assert.match(missingManifest.stdout, /audit evidence dependency/);
  });

  it('accepts the 365-day audit boundary and rejects evidence one day older', async () => {
    fs.writeFileSync(checklistPath, checklist());
    fs.writeFileSync(manifestPath, JSON.stringify(manifest('2025-10-19')));
    const boundary = await run();
    assert.equal(boundary.status, 0, boundary.stdout);

    fs.writeFileSync(manifestPath, JSON.stringify(manifest('2025-10-18')));
    const stale = await run();
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /External audit is stale/);
  });

  it('rejects unavailable audit artifacts and content that does not match its digest', async () => {
    fs.writeFileSync(checklistPath, checklist());
    const unavailable = manifest();
    unavailable.evidence.url = 'http://127.0.0.1:1/audit.pdf';
    fs.writeFileSync(manifestPath, JSON.stringify(unavailable));
    const unavailableResult = await run();
    assert.equal(unavailableResult.status, 1);
    assert.match(unavailableResult.stdout, /unavailable or unverifiable/);

    fs.writeFileSync(manifestPath, JSON.stringify(manifest('2026-10-19', '0'.repeat(64))));
    const digestMismatch = await run();
    assert.equal(digestMismatch.status, 1);
    assert.match(digestMismatch.stdout, /SHA-256 does not match/);
  });

  it('produces deterministic evidence reports across process restarts', async () => {
    fs.writeFileSync(checklistPath, checklist());
    fs.writeFileSync(manifestPath, JSON.stringify(manifest()));
    const first = await run();
    const replay = await run();
    assert.equal(first.status, 0);
    assert.equal(replay.status, 0);
    assert.equal(replay.stdout, first.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), JSON.parse(first.stdout));
  });
});