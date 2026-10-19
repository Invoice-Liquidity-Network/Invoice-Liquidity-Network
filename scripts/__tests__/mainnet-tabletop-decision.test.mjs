import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGoNoGoDecision,
  computeDecisionHash,
  DECISION_ROLES,
} from '../operations/mainnet-tabletop-decision.mjs';

describe('Mainnet Go/No-Go Tabletop Decision Engine (#1330)', () => {
  const cleanSignals = {
    criticalVulnerabilitiesCount: 0,
    externalAuditRemediated: true,
    contractUpgradeTested: true,
    emergencyPauseRehearsed: true,
    rpcFailoverTested: true,
    canarySoakClean: true,
    breakingXdrMutations: false,
    unresolvedSev1Incidents: 0,
  };

  it('delivers unanimous GO verdict when all readiness signals pass', () => {
    const decision = evaluateGoNoGoDecision(cleanSignals);
    assert.equal(decision.verdict, 'GO');
    assert.equal(decision.unanimous, true);
    assert.equal(decision.blockingReasons.length, 0);

    for (const role of DECISION_ROLES) {
      assert.equal(decision.votes[role], 'GO');
    }
    assert.ok(decision.sha256.length === 64);
  });

  it('delivers NO-GO and blocks launch when critical vulnerabilities exist', () => {
    const dirtySignals = { ...cleanSignals, criticalVulnerabilitiesCount: 1 };
    const decision = evaluateGoNoGoDecision(dirtySignals);

    assert.equal(decision.verdict, 'NO-GO');
    assert.equal(decision.unanimous, false);
    assert.equal(decision.votes.SECURITY_LEAD, 'NO-GO');
    assert.match(decision.blockingReasons[0], /unresolved critical\/high vulnerabilities/);
  });

  it('delivers NO-GO when canary soak experiences SLI breaches', () => {
    const dirtySignals = { ...cleanSignals, canarySoakClean: false };
    const decision = evaluateGoNoGoDecision(dirtySignals);

    assert.equal(decision.verdict, 'NO-GO');
    assert.equal(decision.votes.INFRASTRUCTURE_LEAD, 'NO-GO');
    assert.match(decision.blockingReasons[0], /Canary soak period had unresolved SLI breaches/);
  });

  it('generates consistent cryptographic SHA-256 hashes for decision records', () => {
    const hash1 = computeDecisionHash({ test: 123, status: 'GO' });
    const hash2 = computeDecisionHash({ status: 'GO', test: 123 });
    assert.equal(hash1, hash2);
  });
});
