// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { verifyNotificationAddressOwnership, resolveEmailRecipient } from '../src/recipient';

describe('Issue #1281: Notification address ownership verification', () => {
  const validWallet = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const otherWallet = 'GDQJUTQYK2MQX2VGDR2FYWLIYAQIBG2TW2GLNXAQOGF4ECO7D2BK65TX';

  it('verifies ownership when subscription address matches target wallet', () => {
    const check = verifyNotificationAddressOwnership(validWallet, validWallet);
    expect(check.verified).toBe(true);
    expect(check.reason).toBeUndefined();
  });

  it('rejects subscription when address belongs to a different wallet', () => {
    const check = verifyNotificationAddressOwnership(validWallet, otherWallet);
    expect(check.verified).toBe(false);
    expect(check.reason).toBe('unverified_ownership');
  });

  it('rejects invalid or malformed target stellar addresses', () => {
    const check = verifyNotificationAddressOwnership('invalid-stellar-key', validWallet);
    expect(check.verified).toBe(false);
    expect(check.reason).toBe('malformed');
  });

  it('resolveEmailRecipient ignores subscriptions owned by foreign addresses', () => {
    const res = resolveEmailRecipient(validWallet, 'invoice_paid', [
      {
        channel: 'email',
        destination: 'owner@example.com',
        address: otherWallet, // foreign address
        triggers: ['invoice_paid']
      }
    ]);
    expect(res.ok).toBe(false);
  });
});
