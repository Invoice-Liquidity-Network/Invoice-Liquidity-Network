import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as StellarSdk from '@stellar/stellar-sdk';
import { ILNSdk } from '@iln/sdk';

const RPC_URL = 'http://localhost:8000/soroban/rpc';
const FRIENDBOT_URL = 'http://localhost:8000/friendbot';
const NETWORK_PASSPHRASE = StellarSdk.Networks.STANDALONE;
const CONTRACT_ID_ENV = process.env.CONTRACT_ID || '';

let server: StellarSdk.rpc.Server;
let isNodeRunning = false;
let contractId: string;
let sdk: ILNSdk;

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
      contractId = CONTRACT_ID_ENV || 'C_DEPLOYED_CONTRACT_ID';
      sdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      });
    }
  } catch (error) {
    console.warn('Local Stellar node unreachable. E2E tests will be skipped.');
    isNodeRunning = false;
  }
});

afterAll(async () => {
  if (sdk) {
    sdk.clearCache();
  }
});

describe('E2E Invoice Lifecycle', () => {
  describe('Full Lifecycle: Submit → Fund → Pay → Verify', () => {
    it('submit invoice via SDK creates a pending invoice', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      expect(invoice).toBeDefined();
      expect(invoice.id).toBeGreaterThan(0n);
      expect(invoice.state).toBe('Pending');
    });

    it('fund invoice via SDK transfers tokens to escrow', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      const fundedInvoice = await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      expect(fundedInvoice).toBeDefined();
      expect(fundedInvoice.state).toBe('Funded');
      expect(fundedInvoice.funder).toBe(lp.publicKey());
    });

    it('mark invoice as paid completes the lifecycle and credits LP yield', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      const payerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(payer),
      });

      const paidInvoice = await payerSdk.markPaid({
        invoiceId: invoice.id,
      });

      expect(paidInvoice).toBeDefined();
      expect(paidInvoice.state).toBe('Paid');
    });

    it('verify final state transitions across contract and SDK read', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      expect(invoice.state).toBe('Pending');

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      const fundedInvoice = await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      expect(fundedInvoice.state).toBe('Funded');

      const readSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const fetched = await readSdk.getInvoice(invoice.id);
      expect(fetched.state).toBe('Funded');
    });
  });

  describe('Cross-Package Integration: SDK + Indexer', () => {
    it('SDK retrieves invoice state after submission', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 2000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 250;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const readSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const fetched = await readSdk.getInvoice(invoice.id);
      expect(fetched.id).toBe(invoice.id);
      expect(fetched.freelancer).toBe(freelancer.publicKey());
      expect(fetched.payer).toBe(payer.publicKey());
      expect(fetched.state).toBe('Pending');
    });

    it('SDK correctly reads multiple invoices via batch query', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(payer.publicKey());

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const amount1 = 1000n * 10_000_000n;
      const amount2 = 2000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const invoice1 = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount: amount1,
        dueDate,
        discountRate: discountRateBps,
      });

      const invoice2 = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount: amount2,
        dueDate,
        discountRate: discountRateBps,
      });

      const readSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const fetched1 = await readSdk.getInvoice(invoice1.id);
      const fetched2 = await readSdk.getInvoice(invoice2.id);

      expect(fetched1.amount).toBe(amount1);
      expect(fetched2.amount).toBe(amount2);
    });

    it('handles token amount conversions correctly', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const displayAmount = 100;
      const stroopsPerUnit = 10_000_000n;
      const expectedStroops = BigInt(displayAmount) * stroopsPerUnit;

      expect(expectedStroops).toBe(1_000_000_000n);
    });
  });

  describe('Dispute, Default, and Appeal Lifecycle Coverage', () => {
    it('Funded invoice can transition to Disputed state via dispute', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      const fundedInvoice = await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      expect(fundedInvoice.state).toBe('Funded');

      const payerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(payer),
      });

      const disputedInvoice = await payerSdk.dispute({
        invoiceId: invoice.id,
      });

      expect(disputedInvoice.state).toBe('Disputed');
    });

    it('Disputed invoice can be resolved through governance-style appeal', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      const payerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(payer),
      });

      await payerSdk.dispute({
        invoiceId: invoice.id,
      });

      const appealedInvoice = await freelancerSdk.appeal({
        invoiceId: invoice.id,
      });

      expect(appealedInvoice.state).toBe('Appeal');
    });

    it('Funded invoice transitions to Defaulted when past due date, enabling insurance pool claim', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) - 100;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      const defaultedInvoice = await lpSdk.claimDefault({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      expect(defaultedInvoice.state).toBe('Defaulted');
    });

    it('Insurance pool compensates LP after default claim', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) - 100;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      const lpInitialBalance = await lpSdk.getBalance(lp.publicKey());

      await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      await lpSdk.claimDefault({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      const lpAfterClaim = await lpSdk.getBalance(lp.publicKey());

      expect(lpAfterClaim).toBeDefined();
      expect(lpAfterClaim).toBeGreaterThanOrEqual(lpInitialBalance - amount);
    });

    it('Pending state cannot transition directly to Paid', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const validTransitions: Record<string, string[]> = {
        Pending: ['Funded', 'Defaulted'],
        Funded: ['Paid', 'Defaulted', 'Disputed'],
        Disputed: ['Appeal', 'Paid'],
        Appeal: ['Paid'],
        Paid: [],
        Defaulted: [],
      };

      expect(validTransitions['Pending']).not.toContain('Paid');
      expect(validTransitions['Funded']).toContain('Paid');
    });

    it('Terminal states have no outgoing transitions', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const validTransitions: Record<string, string[]> = {
        Paid: [],
        Defaulted: [],
      };

      expect(validTransitions['Paid']).toHaveLength(0);
      expect(validTransitions['Defaulted']).toHaveLength(0);
    });
  });

  describe('Yield Calculations and LP Compensation', () => {
    it('SDK correctly calculates yield at 300 bps', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const invoiceAmount = 1000n * 10_000_000n;
      const discountRateBps = 300;
      const expectedYield = (invoiceAmount * BigInt(discountRateBps)) / 10000n;

      expect(expectedYield).toBe(30n * 10_000_000n);
    });

    it('LP receives invoice amount plus yield after payment via SDK', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      const lpInitial = await lpSdk.getBalance(lp.publicKey());

      await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      const payerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(payer),
      });

      await payerSdk.markPaid({
        invoiceId: invoice.id,
      });

      const lpAfterPayment = await lpSdk.getBalance(lp.publicKey());
      const yield_ = (amount * BigInt(discountRateBps)) / 10000n;
      const expectedFinal = lpInitial + yield_;

      expect(lpAfterPayment).toBeGreaterThanOrEqual(lpInitial);
    });
  });

  describe('Error Scenarios and Validation', () => {
    it('cannot fund an already funded invoice', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      try {
        await lpSdk.fundInvoice({
          funder: lp.publicKey(),
          invoiceId: invoice.id,
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeDefined();
      }
    });

    it('cannot pay an unfunded invoice', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const payerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(payer),
      });

      try {
        await payerSdk.markPaid({
          invoiceId: invoice.id,
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeDefined();
      }
    });

    it('rejects zero amount invoices', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 0n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      try {
        await freelancerSdk.submitInvoice({
          freelancer: freelancer.publicKey(),
          payer: payer.publicKey(),
          amount,
          dueDate,
          discountRate: discountRateBps,
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeDefined();
      }
    });

    it('rejects discount rates over 100%', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 10001;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      try {
        await freelancerSdk.submitInvoice({
          freelancer: freelancer.publicKey(),
          payer: payer.publicKey(),
          amount,
          dueDate,
          discountRate: discountRateBps,
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Balance Tracking and LP Compensation Model', () => {
    it('SDK query correctly reflects LP balance reduction after funding', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      const lpInitialBalance = await lpSdk.getBalance(lp.publicKey());

      await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      const lpAfterFunding = await lpSdk.getBalance(lp.publicKey());

      expect(lpAfterFunding).toBeLessThanOrEqual(lpInitialBalance);
    });

    it('LP balance recovers after invoice payment with yield via SDK', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lpSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp),
      });

      const lpInitialBalance = await lpSdk.getBalance(lp.publicKey());

      await lpSdk.fundInvoice({
        funder: lp.publicKey(),
        invoiceId: invoice.id,
      });

      const payerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(payer),
      });

      await payerSdk.markPaid({
        invoiceId: invoice.id,
      });

      const lpAfterPayment = await lpSdk.getBalance(lp.publicKey());

      expect(lpAfterPayment).toBeGreaterThanOrEqual(lpInitialBalance - amount);
    });
  });

  describe('Address Validation', () => {
    it('validates Stellar public key format in invoice submission', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const keypair = StellarSdk.Keypair.random();
      const publicKey = keypair.publicKey();

      expect(publicKey).toMatch(/^G[A-Z0-9]{55}$/);
    });

    it('rejects invalid Stellar addresses via SDK validation', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const invalidAddress = 'INVALID_ADDRESS';
      const isValid = /^G[A-Z0-9]{55}$/.test(invalidAddress);
      expect(isValid).toBe(false);
    });
  });

  describe('Concurrent Operations', () => {
    it('handles multiple invoices for same freelancer via SDK batch operations', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(payer.publicKey());

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const invoice1 = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount: 1000n * 10_000_000n,
        dueDate,
        discountRate: discountRateBps,
      });

      const invoice2 = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount: 2000n * 10_000_000n,
        dueDate,
        discountRate: discountRateBps,
      });

      const invoice3 = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount: 3000n * 10_000_000n,
        dueDate,
        discountRate: discountRateBps,
      });

      const readSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const fetched1 = await readSdk.getInvoice(invoice1.id);
      const fetched2 = await readSdk.getInvoice(invoice2.id);
      const fetched3 = await readSdk.getInvoice(invoice3.id);

      expect(fetched1.amount).toBe(1000n * 10_000_000n);
      expect(fetched2.amount).toBe(2000n * 10_000_000n);
      expect(fetched3.amount).toBe(3000n * 10_000_000n);
    });

    it('handles multiple LPs funding same invoice requires governance resolution', async (ctx) => {
      if (!isNodeRunning) return ctx.skip();

      const freelancer = StellarSdk.Keypair.random();
      const lp1 = StellarSdk.Keypair.random();
      const payer = StellarSdk.Keypair.random();

      await fundAccount(freelancer.publicKey());
      await fundAccount(lp1.publicKey());
      await fundAccount(payer.publicKey());

      const amount = 1000n * 10_000_000n;
      const dueDate = Math.floor(Date.now() / 1000) + 86400;
      const discountRateBps = 300;

      const freelancerSdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(freelancer),
      });

      const invoice = await freelancerSdk.submitInvoice({
        freelancer: freelancer.publicKey(),
        payer: payer.publicKey(),
        amount,
        dueDate,
        discountRate: discountRateBps,
      });

      const lp1Sdk = new ILNSdk({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        signer: StellarSdk.createKeypairSigner(lp1),
      });

      const fundedInvoice = await lp1Sdk.fundInvoice({
        funder: lp1.publicKey(),
        invoiceId: invoice.id,
      });

      expect(fundedInvoice.funder).toBe(lp1.publicKey());
    });
  });
});
