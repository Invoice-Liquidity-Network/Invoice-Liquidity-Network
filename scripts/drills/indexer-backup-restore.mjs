#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Simple wrapper to run the indexer backup -> restore -> verify flow and
 * record wall-clock timings. Designed to run in staging against a large
 * snapshot. It calls the indexer's HTTP endpoints if the service is running
 * locally (default: http://localhost:3000).
 */

const INDEXER_URL = process.env.INDEXER_URL || 'http://localhost:3000';
const OUT = process.env.OUT || 'drills/indexer-backup-restore-2026-10-01.jsonl';

function now() { return new Date().toISOString(); }

function http(path, method='POST') {
  const cmd = `curl -s -X ${method} ${INDEXER_URL}${path}`;
  return execFileSync('bash', ['-lc', cmd], { encoding: 'utf8' });
}

function run() {
  const record = [];
  console.log('Starting indexer backup/restore drill');

  // Trigger backup
  const t1 = Date.now();
  const backupRes = http('/backup', 'POST');
  const t2 = Date.now();
  record.push({ step: 'backup', start: now(new Date(t1)), end: now(new Date(t2)), durationMs: t2-t1, output: backupRes });

  // Get latest backup metadata
  const latest = http('/backup/latest', 'GET');
  const backupInfo = JSON.parse(latest || '{}');
  const backupPath = backupInfo.backup?.backupPath || backupInfo.backupPath || null;

  if (!backupPath) {
    console.error('No backupPath returned from indexer /backup/latest');
    process.exit(2);
  }

  // Trigger restore
  const t3 = Date.now();
  const restoreRes = http('/backup/restore', 'POST');
  const t4 = Date.now();
  record.push({ step: 'restore', start: now(new Date(t3)), end: now(new Date(t4)), durationMs: t4-t3, output: restoreRes });

  // Trigger integrity verification (if supported)
  const t5 = Date.now();
  const verifyRes = http('/backup/verify', 'POST');
  const t6 = Date.now();
  record.push({ step: 'verify', start: now(new Date(t5)), end: now(new Date(t6)), durationMs: t6-t5, output: verifyRes });

  // Save record
  if (!existsSync('drills')) execFileSync('mkdir -p drills');
  for (const r of record) writeFileSync(OUT, JSON.stringify(r) + '\n', { flag: 'a' });
  console.log('Drill recorded to', OUT);
}

if (import.meta.url === `file://${process.argv[1]}`) run();
