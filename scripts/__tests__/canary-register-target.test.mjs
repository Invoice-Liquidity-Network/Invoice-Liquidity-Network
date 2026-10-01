import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildTargetFile,
  targetFilePath,
  registerTarget,
  deregisterTarget,
} from '../canary/register-target.mjs';

describe('buildTargetFile', () => {
  it('produces a Prometheus file_sd document with the canary/service labels', () => {
    const doc = buildTargetFile({ service: 'indexer', host: '10.0.0.5', port: 3001, metricsPath: '/metrics' });
    assert.deepEqual(doc, [
      {
        targets: ['10.0.0.5:3001'],
        labels: { deployment: 'canary', service: 'indexer', __metrics_path__: '/metrics' },
      },
    ]);
  });
});

describe('registerTarget / deregisterTarget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canary-targets-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a target file at <service>.json under the targets dir', () => {
    registerTarget(dir, { service: 'oracle-service', host: '127.0.0.1', port: 3010, metricsPath: '/v1/metrics' });
    const path = targetFilePath(dir, 'oracle-service');
    assert.ok(existsSync(path));
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(parsed[0].labels.service, 'oracle-service');
    assert.equal(parsed[0].labels.__metrics_path__, '/v1/metrics');
  });

  it('removes the target file on deregister', () => {
    registerTarget(dir, { service: 'notifications', host: '127.0.0.1', port: 4001, metricsPath: '/metrics' });
    const path = targetFilePath(dir, 'notifications');
    assert.ok(existsSync(path));
    deregisterTarget(dir, 'notifications');
    assert.ok(!existsSync(path));
  });

  it('deregistering a target that was never registered is a no-op, not an error', () => {
    assert.doesNotThrow(() => deregisterTarget(dir, 'never-registered'));
  });
});
