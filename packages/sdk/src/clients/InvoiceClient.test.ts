import { Account, Keypair, Networks, nativeToScVal } from '@stellar/stellar-sdk';

import { ContractCallError } from '../errors';

import {
  InvoiceClient,
  InvoiceTransactionSigner,
  exportTransactionsToCsv,
  TransactionRecord,
} from './InvoiceClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOp(overrides: Partial<Record<string, any>> = {}): any {
  return {
    id: 'op-1',
    created_at: '2024-06-01T12:00:00Z',
    type: 'payment',
    source_account: 'GABC',
    from: 'GABC',
    to: 'GXYZ',
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    amount: '100.0000000',
    transaction_hash: 'hash-abc',
    paging_token: 'token-1',
    ...overrides,
  };
}

function mockServer(records: any[]) {
  const callFn = jest.fn().mockResolvedValue({ records });
  const queryChain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: callFn,
  };
  return { queryChain, callFn };
}

const CONTRACT_ID = 'CD3TE3IAHM737P236XZL2OYU275ZKD6MN7YH7PYYAXYIGEH55OPEWYJC';
const TOKEN_ID = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

function makeSigner(publicKey: string): InvoiceTransactionSigner {
  return {
    getPublicKey: jest.fn().mockResolvedValue(publicKey),
    signTransaction: jest.fn(async (transactionXdr: string) => transactionXdr),
  };
}

function makeRpcServer(source: string, overrides: Partial<Record<string, any>> = {}) {
  return {
    getAccount: jest.fn().mockResolvedValue(new Account(source, '1')),
    simulateTransaction: jest.fn().mockResolvedValue({
      result: { retval: nativeToScVal(7n, { type: 'u64' }) },
    }),
    prepareTransaction: jest.fn(async (transaction: { toXDR(): string }) => transaction),
    sendTransaction: jest.fn().mockResolvedValue({ hash: 'tx-hash-123', status: 'PENDING' }),
    pollTransaction: jest.fn().mockResolvedValue({
      status: 'SUCCESS',
      events: [{ topic: ['InvoiceSubmitted'], value: { invoice_id: 7n } }],
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InvoiceClient.getTransactionHistory', () => {
  let client: InvoiceClient;

  beforeEach(() => {
    client = new InvoiceClient('https://horizon-testnet.stellar.org', 'CONTRACT_ID');
  });

  it('returns normalised records from Horizon', async () => {
    const { queryChain } = mockServer([makeOp()]);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC');

    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({
      id: 'op-1',
      type: 'payment',
      from: 'GABC',
      to: 'GXYZ',
      asset: 'USDC',
      amount: '100.0000000',
      transactionHash: 'hash-abc',
    });
    expect(page.count).toBe(1);
  });

  it('maps native XLM asset correctly', async () => {
    const { queryChain } = mockServer([makeOp({ asset_type: 'native', asset_code: undefined })]);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC');
    expect(page.records[0].asset).toBe('XLM');
  });

  // Filter by type
  it('filters records by type', async () => {
    const { queryChain } = mockServer([
      makeOp({ id: 'op-1', type: 'payment' }),
      makeOp({ id: 'op-2', type: 'create_account' }),
    ]);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC', { type: 'payment' });
    expect(page.records).toHaveLength(1);
    expect(page.records[0].id).toBe('op-1');
  });

  it('returns all records when no type filter is given', async () => {
    const { queryChain } = mockServer([
      makeOp({ id: 'op-1', type: 'payment' }),
      makeOp({ id: 'op-2', type: 'create_account' }),
    ]);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC');
    expect(page.records).toHaveLength(2);
  });

  // Filter by date range
  it('filters records by startDate', async () => {
    const { queryChain } = mockServer([
      makeOp({ id: 'op-old', created_at: '2024-01-01T00:00:00Z' }),
      makeOp({ id: 'op-new', created_at: '2024-06-01T00:00:00Z' }),
    ]);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC', {
      startDate: '2024-03-01T00:00:00Z',
    });

    expect(page.records).toHaveLength(1);
    expect(page.records[0].id).toBe('op-new');
  });

  it('filters records by endDate', async () => {
    const { queryChain } = mockServer([
      makeOp({ id: 'op-old', created_at: '2024-01-01T00:00:00Z' }),
      makeOp({ id: 'op-new', created_at: '2024-06-01T00:00:00Z' }),
    ]);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC', {
      endDate: '2024-03-01T00:00:00Z',
    });

    expect(page.records).toHaveLength(1);
    expect(page.records[0].id).toBe('op-old');
  });

  it('filters records by both startDate and endDate', async () => {
    const { queryChain } = mockServer([
      makeOp({ id: 'op-a', created_at: '2024-01-01T00:00:00Z' }),
      makeOp({ id: 'op-b', created_at: '2024-04-01T00:00:00Z' }),
      makeOp({ id: 'op-c', created_at: '2024-08-01T00:00:00Z' }),
    ]);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC', {
      startDate: '2024-03-01T00:00:00Z',
      endDate: '2024-06-01T00:00:00Z',
    });

    expect(page.records).toHaveLength(1);
    expect(page.records[0].id).toBe('op-b');
  });

  it('accepts Date objects for startDate and endDate', async () => {
    const { queryChain } = mockServer([
      makeOp({ id: 'op-a', created_at: '2024-01-01T00:00:00Z' }),
      makeOp({ id: 'op-b', created_at: '2024-06-01T00:00:00Z' }),
    ]);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC', {
      startDate: new Date('2024-03-01'),
      endDate: new Date('2024-12-31'),
    });

    expect(page.records).toHaveLength(1);
    expect(page.records[0].id).toBe('op-b');
  });

  // Pagination
  it('respects the limit option', async () => {
    const ops = Array.from({ length: 10 }, (_, i) =>
      makeOp({ id: `op-${i}`, paging_token: `token-${i}` })
    );
    const { queryChain } = mockServer(ops);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC', { limit: 3 });
    expect(page.records).toHaveLength(3);
    expect(page.count).toBe(3);
  });

  it('clamps limit to 200', async () => {
    const { queryChain } = mockServer([makeOp()]);
    (client as any).server = { payments: () => queryChain };

    await client.getTransactionHistory('GABC', { limit: 9999 });
    expect(queryChain.limit).toHaveBeenCalledWith(200);
  });

  it('returns nextCursor when more pages exist', async () => {
    const ops = Array.from({ length: 5 }, (_, i) =>
      makeOp({ id: `op-${i}`, paging_token: `token-${i}` })
    );
    const { queryChain } = mockServer(ops);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC', { limit: 5 });
    expect(page.nextCursor).toBe('token-4');
  });

  it('returns no nextCursor when records are fewer than limit', async () => {
    const { queryChain } = mockServer([makeOp()]);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC', { limit: 20 });
    expect(page.nextCursor).toBeUndefined();
  });

  it('passes cursor to Horizon when provided', async () => {
    const { queryChain } = mockServer([]);
    (client as any).server = { payments: () => queryChain };

    await client.getTransactionHistory('GABC', { cursor: 'token-42' });
    expect(queryChain.cursor).toHaveBeenCalledWith('token-42');
  });

  it('passes order to Horizon', async () => {
    const { queryChain } = mockServer([]);
    (client as any).server = { payments: () => queryChain };

    await client.getTransactionHistory('GABC', { order: 'asc' });
    expect(queryChain.order).toHaveBeenCalledWith('asc');
  });

  it('defaults to desc order', async () => {
    const { queryChain } = mockServer([]);
    (client as any).server = { payments: () => queryChain };

    await client.getTransactionHistory('GABC');
    expect(queryChain.order).toHaveBeenCalledWith('desc');
  });

  it('returns empty page when Horizon returns no records', async () => {
    const { queryChain } = mockServer([]);
    (client as any).server = { payments: () => queryChain };

    const page = await client.getTransactionHistory('GABC');
    expect(page.records).toHaveLength(0);
    expect(page.nextCursor).toBeUndefined();
    expect(page.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Invoice lifecycle writes
// ---------------------------------------------------------------------------

describe('InvoiceClient invoice lifecycle writes', () => {
  it('submits an invoice through simulate, prepare, sign, submit, and poll', async () => {
    const freelancer = Keypair.random().publicKey();
    const payer = Keypair.random().publicKey();
    const signer = makeSigner(freelancer);
    const rpcServer = makeRpcServer(freelancer);
    const client = new InvoiceClient({
      contractId: CONTRACT_ID,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: Networks.TESTNET,
      signer,
      rpcServer,
    });

    const result = await client.submitInvoice({
      freelancer,
      payer,
      amount: 1_000_000n,
      dueDate: 1_800_000_000n,
      discountRate: 300,
      token: TOKEN_ID,
    });

    expect(result).toMatchObject({
      hash: 'tx-hash-123',
      txHash: 'tx-hash-123',
      invoiceId: 7n,
    });
    expect(result.events[0]).toMatchObject({ type: 'InvoiceSubmitted' });
    expect(rpcServer.getAccount).toHaveBeenCalledWith(freelancer);
    expect(rpcServer.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(rpcServer.prepareTransaction).toHaveBeenCalledTimes(1);
    expect(signer.signTransaction).toHaveBeenCalledWith(expect.any(String), {
      address: freelancer,
      networkPassphrase: Networks.TESTNET,
    });
    expect(rpcServer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(rpcServer.pollTransaction).toHaveBeenCalledWith('tx-hash-123', { attempts: 30 });
  });

  it('funds an invoice with an explicit partial amount', async () => {
    const funder = Keypair.random().publicKey();
    const signer = makeSigner(funder);
    const rpcServer = makeRpcServer(funder);
    const client = new InvoiceClient({
      contractId: CONTRACT_ID,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      signer,
      rpcServer,
    });

    const result = await client.fundInvoice(42n, 500_000n);

    expect(result.hash).toBe('tx-hash-123');
    expect(rpcServer.getAccount).toHaveBeenCalledWith(funder);
    expect(rpcServer.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(signer.signTransaction).toHaveBeenCalledWith(expect.any(String), {
      address: funder,
      networkPassphrase: Networks.TESTNET,
    });
  });

  it('reads invoice state to compute the remaining funding amount when amount is omitted', async () => {
    const funder = Keypair.random().publicKey();
    const signer = makeSigner(funder);
    const invoiceRetval = nativeToScVal(
      new Map<string, unknown>([
        ['amount', 1_000_000n],
        ['amount_funded', 250_000n],
      ])
    );
    const rpcServer = makeRpcServer(funder, {
      simulateTransaction: jest
        .fn()
        .mockResolvedValueOnce({ result: { retval: invoiceRetval } })
        .mockResolvedValueOnce({ result: { retval: nativeToScVal(0, { type: 'u32' }) } }),
    });
    const client = new InvoiceClient({
      contractId: CONTRACT_ID,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      signer,
      rpcServer,
    });

    await client.fundInvoice({ invoiceId: 42n });

    expect(rpcServer.simulateTransaction).toHaveBeenCalledTimes(2);
    expect(rpcServer.prepareTransaction).toHaveBeenCalledTimes(1);
    expect(rpcServer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('marks an invoice as paid with the payer signer', async () => {
    const payer = Keypair.random().publicKey();
    const signer = makeSigner(payer);
    const rpcServer = makeRpcServer(payer, {
      simulateTransaction: jest.fn().mockResolvedValue({
        result: { retval: nativeToScVal(0, { type: 'u32' }) },
      }),
    });
    const client = new InvoiceClient({
      contractId: CONTRACT_ID,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      signer,
      rpcServer,
    });

    await client.markPaid({ invoiceId: 42n, amount: 1_000_000n });

    expect(rpcServer.getAccount).toHaveBeenCalledWith(payer);
    expect(signer.signTransaction).toHaveBeenCalledWith(expect.any(String), {
      address: payer,
      networkPassphrase: Networks.TESTNET,
    });
  });

  it('wraps Soroban simulation failures in ContractCallError', async () => {
    const freelancer = Keypair.random().publicKey();
    const payer = Keypair.random().publicKey();
    const signer = makeSigner(freelancer);
    const rpcServer = makeRpcServer(freelancer, {
      simulateTransaction: jest.fn().mockResolvedValue({ error: 'host invocation failed' }),
    });
    const client = new InvoiceClient({
      contractId: CONTRACT_ID,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      signer,
      rpcServer,
    });

    await expect(
      client.submitInvoice({
        freelancer,
        payer,
        amount: 1_000_000n,
        dueDate: 1_800_000_000n,
        discountRate: 300,
        token: TOKEN_ID,
      })
    ).rejects.toBeInstanceOf(ContractCallError);
  });
});

// ---------------------------------------------------------------------------
// exportTransactionsToCsv
// ---------------------------------------------------------------------------

describe('exportTransactionsToCsv', () => {
  const record: TransactionRecord = {
    id: 'op-1',
    createdAt: '2024-06-01T12:00:00Z',
    type: 'payment',
    from: 'GABC',
    to: 'GXYZ',
    asset: 'USDC',
    amount: '100.0000000',
    transactionHash: 'hash-abc',
  };

  it('produces a header row', () => {
    const csv = exportTransactionsToCsv([record]);
    const firstLine = csv.split('\n')[0];
    expect(firstLine).toBe('id,createdAt,type,from,to,asset,amount,transactionHash');
  });

  it('produces one data row per record', () => {
    const csv = exportTransactionsToCsv([record, { ...record, id: 'op-2' }]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
  });

  it('exports all fields in the correct order', () => {
    const csv = exportTransactionsToCsv([record]);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toBe('op-1,2024-06-01T12:00:00Z,payment,GABC,GXYZ,USDC,100.0000000,hash-abc');
  });

  it('handles undefined optional fields as empty strings', () => {
    const minimal: TransactionRecord = {
      id: 'op-min',
      createdAt: '2024-06-01T12:00:00Z',
      type: 'create_account',
      from: 'GABC',
      transactionHash: 'hash-min',
    };
    const csv = exportTransactionsToCsv([minimal]);
    const dataRow = csv.split('\n')[1];
    expect(dataRow.split(',')).toHaveLength(8);
  });

  it('wraps values containing commas in double quotes', () => {
    const r: TransactionRecord = { ...record, amount: '1,000.00' };
    const csv = exportTransactionsToCsv([r]);
    expect(csv).toContain('"1,000.00"');
  });

  it('escapes double quotes inside values per RFC 4180', () => {
    const r: TransactionRecord = { ...record, asset: 'US"DC' };
    const csv = exportTransactionsToCsv([r]);
    expect(csv).toContain('"US""DC"');
  });

  it('returns only a header row for an empty array', () => {
    const csv = exportTransactionsToCsv([]);
    expect(csv).toBe('id,createdAt,type,from,to,asset,amount,transactionHash');
    expect(csv.split('\n')).toHaveLength(1);
  });
});
