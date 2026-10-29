import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createOracleApp } from './index';

/**
 * Payer/KYB incident runbook (issue #1240).
 *
 * A runbook is only useful if it points at real controls. This suite pins the
 * document to the identifiers an operator will actually meet — health fields,
 * metric and source names, failure codes — and asserts the health control the
 * runbook opens with really exists.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const RUNBOOK_PATH = resolve(REPO_ROOT, 'docs/runbooks/payer-kyb-incidents.md');

describe('payer/KYB incident runbook (#1240)', () => {
  it('exists in docs/runbooks', () => {
    expect(existsSync(RUNBOOK_PATH)).toBe(true);
  });

  it('cross-references the live controls, not invented names', () => {
    const content = readFileSync(RUNBOOK_PATH, 'utf-8');

    for (const identifier of [
      'health().kyb',
      'sources',
      'kyb-primary',
      'kyb-fallback',
      'oracle_failover_events_total',
      'oracle_source_health_state',
      'oracle_payer_authorization_failures_total',
      'rejected-kyb-unavailable',
      'rejected-kyb-unverified',
      'PAYER_KYB_UNAVAILABLE',
      'PAYER_KYB_UNVERIFIED',
      'createKybProvider',
      'required',
      'configured',
      'failover',
    ]) {
      expect(content, `runbook should reference "${identifier}"`).toContain(identifier);
    }
  });

  it('names an owner and an escalation path', () => {
    const content = readFileSync(RUNBOOK_PATH, 'utf-8');

    expect(content).toMatch(/## Ownership and escalation/);
    expect(content).toContain('incident-response.md');
  });

  it('the health control it opens with is exported and correct', async () => {
    const { close, health } = await createOracleApp({
      indexerBaseUrl: 'http://indexer.local',
      historyProvider: async () => [],
      reputationProvider: async () => ({
        address: 'GPAYER',
        score: 0,
        totalPaid: 0n,
        invoiceCount: 0,
        lastActivity: 0,
        rank: 0,
      }),
    });

    try {
      const snapshot = health();
      // The runbook's opening `health()` example must be a real shape.
      expect(snapshot.kyb).toEqual({ required: false, configured: false, failover: false });
      expect(snapshot.sources).toEqual({});
    } finally {
      await close();
    }
  });
});
