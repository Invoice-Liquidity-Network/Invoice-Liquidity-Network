import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { updateChecklistContent, extractLinkedIssueNumbers } from '../mainnet-checklist-parser.js';

describe('mainnet checklist parser', () => {
  const repoUrl = 'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/';

  const sampleChecklistFixture = `
# Mainnet Launch Checklist

## Security

| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| External security audit | Audit Soroban contracts | Security lead | Not started | [Audit link](https://example.com) |
| Unified security policy | Publish reporting policy | Security lead | In progress | [#299](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/299) |
| Local dev guide | Dev setup guide | Docs lead | In progress | [#300](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/300) |
| Glossary | Define protocol terms | Docs lead | In progress | [#301](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/301) |
`;

  test('extracts all unique linked issue numbers from markdown checklist fixture', () => {
    const issueNumbers = extractLinkedIssueNumbers(sampleChecklistFixture, repoUrl);
    assert.deepEqual(issueNumbers, [299, 300, 301]);
  });

  test('updates status to Done only for closed issue rows', () => {
    const closedIssues = new Set([299, 301]);
    const updated = updateChecklistContent({
      content: sampleChecklistFixture,
      repoUrl,
      closedIssues,
    });

    assert.ok(
      updated.includes(
        '| Unified security policy | Publish reporting policy | Security lead | Done | [#299](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/299) |'
      )
    );
    assert.ok(
      updated.includes(
        '| Local dev guide | Dev setup guide | Docs lead | In progress | [#300](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/300) |'
      )
    );
    assert.ok(
      updated.includes(
        '| Glossary | Define protocol terms | Docs lead | Done | [#301](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/issues/301) |'
      )
    );
  });

  test('preserves non-matching lines and non-table content unchanged', () => {
    const closedIssues = new Set([299]);
    const updated = updateChecklistContent({
      content: sampleChecklistFixture,
      repoUrl,
      closedIssues,
    });

    assert.ok(updated.includes('# Mainnet Launch Checklist'));
    assert.ok(updated.includes('| Item | Description | Owner | Status | Link |'));
    assert.ok(
      updated.includes(
        '| External security audit | Audit Soroban contracts | Security lead | Not started | [Audit link](https://example.com) |'
      )
    );
  });
});
