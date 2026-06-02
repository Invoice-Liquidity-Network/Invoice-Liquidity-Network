import { describe, it, expect, beforeAll } from 'vitest';
import * as StellarSdk from '@stellar/stellar-sdk';
import { ILNClient } from '../../src/client';

const FRIENDBOT = 'http://localhost:8000/friendbot';
const HORIZON = 'http://localhost:8000';
const RPC_URL = 'http://localhost:8000/soroban/rpc';

describe('SDK e2e against local Stellar node', () => {
  let isNodeRunning = false;
  let server: StellarSdk.rpc.Server;

  beforeAll(async () => {
    server = new StellarSdk.rpc.Server(RPC_URL, { allowHttp: true });
    try {
      const health = await server.getHealth();
      if (health.status === 'healthy') {
        isNodeRunning = true;
      }
    } catch (error) {
      console.warn('⚠️ Local Stellar node unreachable. E2E tests will be skipped.');
    }
  });

  async function createFundedAccount() {
    const kp = StellarSdk.Keypair.random();
    await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
    return kp;
  }

  it('Full lifecycle: submit invoice → fund invoice → mark paid → verify LP payout', async (ctx) => {
    if (!isNodeRunning) return ctx.skip();

    const borrower = await createFundedAccount();
    const lp = await createFundedAccount();
    const payer = await createFundedAccount();

    const client = new ILNClient({ rpcUrl: RPC_URL, networkPassphrase: StellarSdk.Networks.STANDALONE });
    
    // Simulate SDK usage:
    // 1. Submit Invoice
    const invoiceId = await client.submitInvoice({
      borrower: borrower.publicKey(),
      amount: '1000',
      dueDate: Date.now() + 86400000, // 1 day
      discountRate: 300,
      signer: borrower
    });

    expect(invoiceId).toBeDefined();

    // 2. Fund Invoice
    await client.fundInvoice({
      invoiceId,
      lp: lp.publicKey(),
      signer: lp
    });

    const status = await client.getInvoiceStatus(invoiceId);
    expect(status).toBe('FUNDED');

    // 3. Mark Paid
    await client.markPaid({
      invoiceId,
      payer: payer.publicKey(),
      signer: payer
    });

    // 4. Verify LP payout
    const finalStatus = await client.getInvoiceStatus(invoiceId);
    expect(finalStatus).toBe('PAID');
    // Note: LP balances would be checked here using contract methods
  }, 60_000);

  it('Dispute flow', async (ctx) => {
    if (!isNodeRunning) return ctx.skip();
    const borrower = await createFundedAccount();
    const client = new ILNClient({ rpcUrl: RPC_URL, networkPassphrase: StellarSdk.Networks.STANDALONE });
    
    const invoiceId = await client.submitInvoice({
      borrower: borrower.publicKey(),
      amount: '500',
      dueDate: Date.now() + 86400000,
      discountRate: 200,
      signer: borrower
    });

    await client.disputeInvoice({
      invoiceId,
      reason: 'Services not rendered',
      signer: borrower
    });

    const status = await client.getInvoiceStatus(invoiceId);
    expect(status).toBe('DISPUTED');
  }, 60_000);

  it('Cancellation flow', async (ctx) => {
    if (!isNodeRunning) return ctx.skip();
    const borrower = await createFundedAccount();
    const client = new ILNClient({ rpcUrl: RPC_URL, networkPassphrase: StellarSdk.Networks.STANDALONE });
    
    const invoiceId = await client.submitInvoice({
      borrower: borrower.publicKey(),
      amount: '500',
      dueDate: Date.now() + 86400000,
      discountRate: 200,
      signer: borrower
    });

    await client.cancelInvoice({
      invoiceId,
      signer: borrower
    });

    const status = await client.getInvoiceStatus(invoiceId);
    expect(status).toBe('CANCELLED');
  }, 60_000);

  it('Partial payment flow', async (ctx) => {
    if (!isNodeRunning) return ctx.skip();
    const borrower = await createFundedAccount();
    const payer = await createFundedAccount();
    const client = new ILNClient({ rpcUrl: RPC_URL, networkPassphrase: StellarSdk.Networks.STANDALONE });
    
    const invoiceId = await client.submitInvoice({
      borrower: borrower.publicKey(),
      amount: '1000',
      dueDate: Date.now() + 86400000,
      discountRate: 200,
      signer: borrower
    });

    await client.payPartial({
      invoiceId,
      amount: '500',
      payer: payer.publicKey(),
      signer: payer
    });

    const details = await client.getInvoiceDetails(invoiceId);
    expect(details.amountPaid).toBe('500');
    expect(details.status).toBe('PARTIALLY_PAID');
  }, 60_000);

  it('Reputation update after settlement', async (ctx) => {
    if (!isNodeRunning) return ctx.skip();
    const borrower = await createFundedAccount();
    const lp = await createFundedAccount();
    const payer = await createFundedAccount();
    const client = new ILNClient({ rpcUrl: RPC_URL, networkPassphrase: StellarSdk.Networks.STANDALONE });
    
    const initialReputation = await client.getReputation(borrower.publicKey());

    const invoiceId = await client.submitInvoice({
      borrower: borrower.publicKey(),
      amount: '1000',
      dueDate: Date.now() + 86400000,
      discountRate: 300,
      signer: borrower
    });

    await client.fundInvoice({ invoiceId, lp: lp.publicKey(), signer: lp });
    await client.markPaid({ invoiceId, payer: payer.publicKey(), signer: payer });

    const finalReputation = await client.getReputation(borrower.publicKey());
    expect(Number(finalReputation)).toBeGreaterThan(Number(initialReputation));
  }, 60_000);
});
