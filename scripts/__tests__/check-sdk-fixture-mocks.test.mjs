import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowlist, detectMocks, diffAgainstAllowlist } from '../check-sdk-fixture-mocks.mjs';

const SAMPLE_DOC = `# SDK Integration Fixture Audit

## Documented mocks (CI allowlist)

\`\`\`text
# Generic wallet-lifecycle emulator; adapts to the real TransactionSigner via
# toTransactionSigner() so drift fails typecheck instead of this guard.
tests/sdk-integration/src/mockWallet.ts
tests/sdk-integration/src/mockNetwork.ts
\`\`\`
`;

describe('parseAllowlist', () => {
  it('extracts repo-relative paths from the fenced block', () => {
    const allowlist = parseAllowlist(SAMPLE_DOC);
    assert.deepEqual(
      [...allowlist].sort(),
      ['tests/sdk-integration/src/mockNetwork.ts', 'tests/sdk-integration/src/mockWallet.ts']
    );
  });

  it('ignores blank lines and #-prefixed comments', () => {
    const allowlist = parseAllowlist(SAMPLE_DOC);
    for (const entry of allowlist) {
      assert.ok(!entry.startsWith('#'));
      assert.ok(entry.length > 0);
    }
  });

  it('returns null when the allowlist block is missing', () => {
    assert.equal(parseAllowlist('# Some other doc\n\nNo allowlist here.\n'), null);
  });
});

describe('detectMocks', () => {
  it('flags a file that reassigns globalThis.fetch', () => {
    const files = new Map([
      ['tests/sdk-integration/src/mockNetwork.ts', "(globalThis as any).fetch = async () => {};"],
    ]);
    assert.deepEqual([...detectMocks(files)], ['tests/sdk-integration/src/mockNetwork.ts']);
  });

  it('flags a class named Mock<ChainThing>', () => {
    const files = new Map([
      ['tests/sdk-integration/src/mockWallet.ts', 'export class MockWallet extends EventEmitter {}'],
    ]);
    assert.deepEqual([...detectMocks(files)], ['tests/sdk-integration/src/mockWallet.ts']);
  });

  it('flags vi.mock of @stellar/stellar-sdk', () => {
    const files = new Map([
      ['sdk/src/integration/fake.test.ts', "vi.mock('@stellar/stellar-sdk', () => ({}));"],
    ]);
    assert.deepEqual([...detectMocks(files)], ['sdk/src/integration/fake.test.ts']);
  });

  it('does not flag generic, chain-agnostic helpers', () => {
    const files = new Map([
      ['tests/sdk-integration/src/dataGenerators.ts', 'export function buildInvoice() { return { id: 1 }; }'],
      ['tests/sdk-integration/src/assertions.ts', "import { expect } from 'vitest';"],
    ]);
    assert.deepEqual([...detectMocks(files)], []);
  });
});

describe('diffAgainstAllowlist', () => {
  it('reports no undocumented mocks when detected matches the allowlist exactly', () => {
    const detected = new Set(['tests/sdk-integration/src/mockWallet.ts']);
    const allowlist = new Set(['tests/sdk-integration/src/mockWallet.ts']);
    const { undocumented, stale } = diffAgainstAllowlist(detected, allowlist);
    assert.deepEqual(undocumented, []);
    assert.deepEqual(stale, []);
  });

  it('flags a newly introduced mock that is not in the allowlist', () => {
    const detected = new Set([
      'tests/sdk-integration/src/mockWallet.ts',
      'sdk/src/integration/mockRpc.ts',
    ]);
    const allowlist = new Set(['tests/sdk-integration/src/mockWallet.ts']);
    const { undocumented } = diffAgainstAllowlist(detected, allowlist);
    assert.deepEqual(undocumented, ['sdk/src/integration/mockRpc.ts']);
  });

  it('flags an allowlist entry that no longer matches any detected mock as stale', () => {
    const detected = new Set(['tests/sdk-integration/src/mockWallet.ts']);
    const allowlist = new Set([
      'tests/sdk-integration/src/mockWallet.ts',
      'tests/sdk-integration/src/removedMock.ts',
    ]);
    const { stale } = diffAgainstAllowlist(detected, allowlist);
    assert.deepEqual(stale, ['tests/sdk-integration/src/removedMock.ts']);
  });
});
