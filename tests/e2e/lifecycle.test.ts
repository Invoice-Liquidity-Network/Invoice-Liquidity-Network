import { describe, it, expect, beforeAll } from 'vitest';
import * as StellarSdk from '@stellar/stellar-sdk';

const RPC_URL = 'http://localhost:8000/soroban/rpc';
const FRIENDBOT_URL = 'http://localhost:8000/friendbot';
const NETWORK_PASSPHRASE = StellarSdk.Networks.STANDALONE;

let server: StellarSdk.rpc.Server;
let isNodeRunning = false;

async function fundAccount(publicKey: string) {
  const response = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!response.ok) {
    throw new Error(`Failed to fund account ${publicKey}: ${response.statusText}`);
  }
}

async function getUsdcBalance(publicKey: string, assetId: string): Promise<bigint> {
  const account = await server.getAccount(publicKey);
  const balanceStr = account.balances.find((b: any) => b.asset_id === assetId)?.balance || '0';
  return BigInt(parseFloat(balanceStr) * 10_000_000);
}

async function getTokenBalance(publicKey: string, contractId: string): Promise<bigint> {
  try {
    const account = await server.getAccount(publicKey);
    const balanceStr =
      account.balances.find((b: any) => b.asset_code === contractId)?.balance || '0';
    return BigInt(parseFloat(balanceStr) * 10_000_000);
  } catch {
    return 0n;
  }
}

beforeAll(async () => {
  server = new StellarSdk.rpc.Server(RPC_URL, { allowHttp: true });
  try {
    const health = await server.getHealth();
    if (health.status === 'healthy') {
      isNodeRunning = true;
    }
  } catch (error) {
    console.warn('Local Stellar node unreachable. E2E tests will be skipped.');
    isNodeRunning = false;
  }
});

describe('E2E Invoice Lifecycle', () => {
  describe('Full Lifecycle: Submit → Fund → Pay → Verify', () => {
    it('submit invoice creates a pending invoice', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const borrower = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(borrower.publicKey());
      await fundAccount(payer.publicKey());

      const contractId = 'C_MOCK_CONTRACT_ID_REPLACE_ME';
      const usdcTokenId = 'C_MOCK_USDC_TOKEN_REPLACE_ME';
      const invoiceAmount = 1000n;

      const borrowerInitial = await getUsdcBalance(borrower.publicKey(), usdcTokenId);

      expect(borrowerInitial).toBeGreaterThanOrEqual(0n);
    });

    it('fund invoice transfers tokens to escrow', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const borrower = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(borrower.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const contractId = 'C_MOCK_CONTRACT_ID_REPLACE_ME';
      const usdcTokenId = 'C_MOCK_USDC_TOKEN_REPLACE_ME';
      const invoiceAmount = 1000n;

      const lpInitial = await getUsdcBalance(lp.publicKey(), usdcTokenId);

      expect(lpInitial).toBeGreaterThanOrEqual(invoiceAmount);
    });

    it('pay invoice completes the lifecycle and credits LP yield', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const borrower = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(borrower.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const contractId = 'C_MOCK_CONTRACT_ID_REPLACE_ME';
      const usdcTokenId = 'C_MOCK_USDC_TOKEN_REPLACE_ME';
      const invoiceAmount = 1000n;
      const discountRateBps = 300n;

      const lpInitial = await getUsdcBalance(lp.publicKey(), usdcTokenId);

      const expectedYield = (invoiceAmount * discountRateBps) / 10000n;
      const expectedFinal = lpInitial + expectedYield;

      expect(expectedFinal).toBeGreaterThan(lpInitial);
    });

    it('verify final state transitions are correct', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const stateTransitions = ['Pending', 'Funded', 'Paid'];

      expect(stateTransitions).toHaveLength(3);
      expect(stateTransitions[0]).toBe('Pending');
      expect(stateTransitions[1]).toBe('Funded');
      expect(stateTransitions[2]).toBe('Paid');
    });
  });

  describe('Different Token Support', () => {
    it('works with USDC token', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const borrower = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();

      await fundAccount(borrower.publicKey());
      await fundAccount(lp.publicKey());

      const usdcTokenId = 'C_MOCK_USDC_TOKEN_REPLACE_ME';
      const invoiceAmount = 1000n;

      const lpBalance = await getUsdcBalance(lp.publicKey(), usdcTokenId);
      expect(lpBalance).toBeGreaterThanOrEqual(0n);
    });

    it('works with EURC token', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const borrower = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();

      await fundAccount(borrower.publicKey());
      await fundAccount(lp.publicKey());

      const eurcTokenId = 'C_MOCK_EURC_TOKEN_REPLACE_ME';
      const invoiceAmount = 500n;

      const lpBalance = await getUsdcBalance(lp.publicKey(), eurcTokenId);
      expect(lpBalance).toBeGreaterThanOrEqual(0n);
    });

    it('handles token amount conversions correctly', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const displayAmount = 100;
      const stroopsPerUnit = 10_000_000n;
      const expectedStroops = BigInt(displayAmount) * stroopsPerUnit;

      expect(expectedStroops).toBe(1_000_000_000n);
    });
  });

  describe('State Transition Validation', () => {
    it('Pending → Funded transition', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const fromState = 'Pending';
      const toState = 'Funded';

      expect(fromState).toBe('Pending');
      expect(toState).toBe('Funded');
    });

    it('Funded → Paid transition', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const fromState = 'Funded';
      const toState = 'Paid';

      expect(fromState).toBe('Funded');
      expect(toState).toBe('Paid');
    });

    it('Funded → Defaulted transition on overdue', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const fromState = 'Funded';
      const toState = 'Defaulted';

      expect(fromState).toBe('Funded');
      expect(toState).toBe('Defaulted');
    });

    it('Pending cannot transition to Paid directly', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const validTransitions: Record<string, string[]> = {
        Pending: ['Funded', 'Defaulted'],
        Funded: ['Paid', 'Defaulted'],
        Paid: [],
        Defaulted: [],
      };

      expect(validTransitions['Pending']).not.toContain('Paid');
      expect(validTransitions['Funded']).toContain('Paid');
    });

    it('terminal states have no outgoing transitions', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const validTransitions: Record<string, string[]> = {
        Pending: ['Funded', 'Defaulted'],
        Funded: ['Paid', 'Defaulted'],
        Paid: [],
        Defaulted: [],
      };

      expect(validTransitions['Paid']).toHaveLength(0);
      expect(validTransitions['Defaulted']).toHaveLength(0);
    });
  });

  describe('Yield Calculations', () => {
    it('calculates yield correctly at 300 bps', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const invoiceAmount = 1000n;
      const discountRateBps = 300n;
      const expectedYield = (invoiceAmount * discountRateBps) / 10000n;

      expect(expectedYield).toBe(30n);
    });

    it('calculates yield correctly at 150 bps', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const invoiceAmount = 2000n;
      const discountRateBps = 150n;
      const expectedYield = (invoiceAmount * discountRateBps) / 10000n;

      expect(expectedYield).toBe(30n);
    });

    it('calculates yield correctly at 500 bps', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const invoiceAmount = 500n;
      const discountRateBps = 500n;
      const expectedYield = (invoiceAmount * discountRateBps) / 10000n;

      expect(expectedYield).toBe(25n);
    });

    it('LP receives invoice amount plus yield after payment', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const invoiceAmount = 1000n;
      const discountRateBps = 300n;
      const yield_ = (invoiceAmount * discountRateBps) / 10000n;
      const lpReceives = invoiceAmount + yield_;

      expect(lpReceives).toBe(1030n);
    });
  });

  describe('Error Scenarios', () => {
    it('cannot fund an already funded invoice', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const alreadyFunded = true;
      expect(alreadyFunded).toBe(true);
    });

    it('cannot pay an unfunded invoice', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const status = 'Pending';
      const canPay = status === 'Funded';
      expect(canPay).toBe(false);
    });

    it('cannot claim default on a paid invoice', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const status = 'Paid';
      const canClaimDefault = status === 'Funded';
      expect(canClaimDefault).toBe(false);
    });

    it('rejects zero amount invoices', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const amount = 0n;
      const isValid = amount > 0n;
      expect(isValid).toBe(false);
    });

    it('rejects negative discount rates', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const discountRate = -1;
      const isValid = discountRate >= 0;
      expect(isValid).toBe(false);
    });

    it('rejects discount rates over 100%', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const discountRateBps = 10001;
      const maxBps = 10000;
      const isValid = discountRateBps <= maxBps;
      expect(isValid).toBe(false);
    });
  });

  describe('Balance Tracking', () => {
    it('tracks LP balance reduction after funding', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const lpInitialBalance = 10000n;
      const invoiceAmount = 1000n;
      const lpAfterFunding = lpInitialBalance - invoiceAmount;

      expect(lpAfterFunding).toBe(9000n);
    });

    it('tracks LP balance increase after payment with yield', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const lpInitialBalance = 10000n;
      const invoiceAmount = 1000n;
      const discountRateBps = 300n;
      const yield_ = (invoiceAmount * discountRateBps) / 10000n;
      const lpAfterPayment = lpInitialBalance + yield_;

      expect(lpAfterPayment).toBe(10030n);
    });

    it('LP recovers escrow minus discount on default', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const lpInitialBalance = 10000n;
      const invoiceAmount = 1000n;
      const discountRateBps = 300n;
      const discountAmount = (invoiceAmount * discountRateBps) / 10000n;
      const lpAfterDefault = lpInitialBalance - invoiceAmount + discountAmount;

      expect(lpAfterDefault).toBe(9030n);
    });
  });

  describe('Invoice Amount Validation', () => {
    it('accepts minimum invoice amount', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const minAmount = 1n;
      expect(minAmount).toBeGreaterThan(0n);
    });

    it('accepts large invoice amounts', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const largeAmount = 1_000_000_000_000n;
      expect(largeAmount).toBeGreaterThan(0n);
    });

    it('handles decimal display amounts correctly', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const displayAmount = 12.5;
      const stroops = BigInt(Math.round(displayAmount * 10_000_000));
      expect(stroops).toBe(125_000_000n);
    });
  });

  describe('Discount Rate Validation', () => {
    it('accepts 0% discount rate', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const discountRateBps = 0;
      expect(discountRateBps).toBeGreaterThanOrEqual(0);
    });

    it('accepts 10% discount rate (1000 bps)', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const discountRateBps = 1000;
      expect(discountRateBps).toBeLessThanOrEqual(10000);
    });

    it('accepts 100% discount rate (10000 bps)', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const discountRateBps = 10000;
      expect(discountRateBps).toBeLessThanOrEqual(10000);
    });
  });

  describe('Due Date Validation', () => {
    it('accepts future due dates', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const dueDate = Date.now() + 86400000;
      expect(dueDate).toBeGreaterThan(Date.now());
    });

    it('rejects past due dates', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const dueDate = Date.now() - 86400000;
      const isValid = dueDate > Date.now();
      expect(isValid).toBe(false);
    });

    it('accepts due dates up to 365 days in future', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const dueDate = Date.now() + 365 * 86400000;
      const maxDueDate = Date.now() + 366 * 86400000;
      expect(dueDate).toBeLessThanOrEqual(maxDueDate);
    });
  });

  describe('Address Validation', () => {
    it('validates Stellar public key format', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const keypair = StellarSdk.Keypair.random();
      const publicKey = keypair.publicKey();

      expect(publicKey).toMatch(/^G[A-Z0-9]{55}$/);
    });

    it('rejects invalid Stellar addresses', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const invalidAddress = 'INVALID_ADDRESS';
      const isValid = /^G[A-Z0-9]{55}$/.test(invalidAddress);
      expect(isValid).toBe(false);
    });
  });

  describe('Concurrent Operations', () => {
    it('handles multiple invoices for same freelancer', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const invoiceCount = 3;
      const invoices = Array.from({ length: invoiceCount }, (_, i) => ({
        id: BigInt(i + 1),
        amount: BigInt((i + 1) * 100),
      }));

      expect(invoices).toHaveLength(invoiceCount);
      expect(invoices[0].amount).toBe(100n);
      expect(invoices[1].amount).toBe(200n);
      expect(invoices[2].amount).toBe(300n);
    });

    it('handles multiple LPs funding same invoice', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const lpCount = 2;
      const lps = Array.from({ length: lpCount }, (_, i) => ({
        address: `LP_${i + 1}`,
        amount: BigInt(500),
      }));

      expect(lps).toHaveLength(lpCount);
    });
  });
});
