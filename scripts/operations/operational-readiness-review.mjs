#!/usr/bin/env node

/**
 * Operational Readiness Review (ORR) for Mainnet Controls (#1324)
 *
 * Programmatically audits and enforces the operational readiness controls
 * required prior to ILN mainnet cutover across Security, Smart Contracts,
 * Operations & Resiliency, and Observability.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

export const MAINNET_CONTROLS_SPEC = [
  {
    id: 'SEC-01',
    category: 'Security',
    name: 'Unified Security Policy',
    checkFile: 'SECURITY.md',
    validator: (content) => content.includes('Reporting a Vulnerability') && content.includes('Response Process'),
  },
  {
    id: 'SEC-02',
    category: 'Security',
    name: 'Bug Bounty Program Active',
    checkFile: 'docs/bug-bounty.md',
    validator: (content) => content.includes('Reward Tiers') && content.includes('Intake and Triage Process'),
  },
  {
    id: 'OPS-01',
    category: 'Operations',
    name: 'Emergency Feature Disable & Circuit Breaker',
    checkFile: 'scripts/drills/emergency-feature-disable.mjs',
    validator: (content) => content.includes('EmergencyFeatureManager') && content.includes('assertFeatureEnabled'),
  },
  {
    id: 'OPS-02',
    category: 'Operations',
    name: 'Service Dependency Failure Injection Tests',
    checkFile: 'scripts/testing/service-dependency-failure-injection.mjs',
    validator: (content) => content.includes('DependencyFailureInjector') && content.includes('injectAnchorFailure'),
  },
  {
    id: 'OPS-03',
    category: 'Operations',
    name: 'Release Rollback Criteria for SDK & Services',
    checkFile: 'docs/release-rollback-criteria.md',
    validator: (content) => content.includes('SDK Rollback Criteria') && content.includes('Microservices Rollback Criteria'),
  },
  {
    id: 'OPS-04',
    category: 'Operations',
    name: 'Postmortem SLA & Action Items Tracking',
    checkFile: 'scripts/enforce-postmortem-sla.mjs',
    validator: (content) => content.includes('auditPostmortemActions') && content.includes('POSTMORTEM_SLA_HOURS'),
  },
  {
    id: 'OBS-01',
    category: 'Observability',
    name: 'Production Grafana Dashboard & Service Metrics',
    checkFile: 'monitoring/grafana/dashboard.json',
    validator: (content) => content.includes('iln-operational-observability'),
  },
];

export function auditMainnetOperationalReadiness(root = repoRoot) {
  const results = MAINNET_CONTROLS_SPEC.map((spec) => {
    const fullPath = join(root, spec.checkFile);
    if (!existsSync(fullPath)) {
      return {
        id: spec.id,
        category: spec.category,
        name: spec.name,
        status: 'FAIL',
        evidence: `Missing required file: ${spec.checkFile}`,
      };
    }

    try {
      const content = readFileSync(fullPath, 'utf-8');
      const passed = spec.validator ? spec.validator(content) : true;
      return {
        id: spec.id,
        category: spec.category,
        name: spec.name,
        status: passed ? 'PASS' : 'FAIL',
        evidence: passed ? `Validated against ${spec.checkFile}` : `Validation failed for ${spec.checkFile}`,
      };
    } catch (err) {
      return {
        id: spec.id,
        category: spec.category,
        name: spec.name,
        status: 'FAIL',
        evidence: `Read error on ${spec.checkFile}: ${err.message}`,
      };
    }
  });

  const totalControls = results.length;
  const passedControls = results.filter((r) => r.status === 'PASS').length;
  const failedControls = totalControls - passedControls;
  const passRatePercent = Math.round((passedControls / totalControls) * 100);
  const signOffEligible = failedControls === 0;

  return {
    timestamp: new Date().toISOString(),
    totalControls,
    passedControls,
    failedControls,
    passRatePercent,
    signOffEligible,
    readinessStatus: signOffEligible ? 'MAINNET_READY' : 'READINESS_GAPS_DETECTED',
    controls: results,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Auditing Operational Readiness for Mainnet Controls (#1324)...');
  const report = auditMainnetOperationalReadiness();
  console.log(JSON.stringify(report, null, 2));
  if (!report.signOffEligible) {
    process.exit(1);
  }
}
