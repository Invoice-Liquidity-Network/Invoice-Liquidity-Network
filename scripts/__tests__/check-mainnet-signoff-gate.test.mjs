import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMainnetSignOff } from '../operations/check-mainnet-signoff-gate.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Mainnet Sign-Off Incomplete Checklist Gate Suite (#1301)', () => {
  it('passes validation when canonical checklist has all items completed and sign-off checked', () => {
    const res = validateMainnetSignOff();
    assert.equal(res.valid, true);
    assert.equal(res.incompleteCount, 0);
    assert.equal(res.isFinalSignedOff, true);
    assert.ok(res.totalTableItems > 10);
  });

  it('fails closed when final sign-off is checked but an item is marked Pending', () => {
    const tempFile = join(__dirname, 'temp-checklist-test.md');
    const mockContent = `
## Security
| Item | Description | Owner | Status | Link |
| --- | --- | --- | --- | --- |
| External security audit | Audit | Security lead | Pending | [link](audit.md) |

- [x] **Final Org-Level Sign-off**
`;
    writeFileSync(tempFile, mockContent, 'utf-8');

    try {
      const res = validateMainnetSignOff(tempFile);
      assert.equal(res.valid, false);
      assert.equal(res.incompleteCount, 1);
      assert.equal(res.incompleteItems[0].item, 'External security audit');
    } finally {
      unlinkSync(tempFile);
    }
  });
});
