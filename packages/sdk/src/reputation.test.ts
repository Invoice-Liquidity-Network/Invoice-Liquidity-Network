import { nativeToScVal, scValToNative, xdr, Keypair } from '@stellar/stellar-sdk';

import { ReputationClient, type ReputationScore } from './reputation';

const TEST_PUBLIC_KEY = Keypair.random().publicKey();
const TEST_CONTRACT_ID = Keypair.random().publicKey();

function makeScoreScVal(overrides: Partial<Record<string, unknown>> = {}) {
  const fields: Record<string, unknown> = {
    score: nativeToScVal(85, { type: 'u32' }),
    total_paid: nativeToScVal(5_000_000_000n, { type: 'i128' }),
    invoice_count: nativeToScVal(42, { type: 'u32' }),
    last_activity: nativeToScVal(1_700_000_000n, { type: 'u64' }),
    rank: nativeToScVal(5, { type: 'u32' }),
    ...overrides,
  };
  return xdr.ScVal.scvMap(
    Object.entries(fields).map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: nativeToScVal(key, { type: 'symbol' }),
          val: val as xdr.ScVal,
        })
    )
  );
}

describe('ReputationClient', () => {
  it('should initialize correctly', () => {
    const client = new ReputationClient('https://soroban-testnet.stellar.org', TEST_CONTRACT_ID);
    expect(client).toBeDefined();
  });

  describe('getReputation', () => {
    it('returns a zeroed ReputationScore when the address is not found', async () => {
      const client = new ReputationClient('https://soroban-testnet.stellar.org', TEST_CONTRACT_ID);
      jest.spyOn(client as any, 'simulate').mockRejectedValue(new Error('not found'));

      const result = await client.getReputation(TEST_PUBLIC_KEY);
      expect(result.address).toBe(TEST_PUBLIC_KEY);
      expect(result.score).toBe(0);
      expect(result.totalPaid).toBe(0n);
      expect(result.invoiceCount).toBe(0);
      expect(result.lastActivity).toBe(0);
      expect(result.rank).toBe(0);
    });

    it('parses a valid contract response into a ReputationScore', async () => {
      const mapScVal = makeScoreScVal();

      const client = new ReputationClient('https://soroban-testnet.stellar.org', TEST_CONTRACT_ID);
      jest.spyOn(client as any, 'simulate').mockImplementation(async () => mapScVal);

      const result = await client.getReputation(TEST_PUBLIC_KEY);
      expect(result.address).toBe(TEST_PUBLIC_KEY);
      expect(result.score).toBe(85);
      expect(result.totalPaid).toBe(5_000_000_000n);
      expect(result.invoiceCount).toBe(42);
      expect(result.lastActivity).toBe(1_700_000_000);
      expect(result.rank).toBe(5);
    });
  });

  describe('getReputationScore', () => {
    it('returns 0 for an unknown address', async () => {
      const client = new ReputationClient('https://soroban-testnet.stellar.org', TEST_CONTRACT_ID);
      jest.spyOn(client as any, 'simulate').mockRejectedValue(new Error('not found'));

      const score = await client.getReputationScore(TEST_PUBLIC_KEY);
      expect(score).toBe(0);
    });

    it('returns the score from a valid response', async () => {
      const mapScVal = makeScoreScVal({ score: nativeToScVal(92, { type: 'u32' }) });

      const client = new ReputationClient('https://soroban-testnet.stellar.org', TEST_CONTRACT_ID);
      jest.spyOn(client as any, 'simulate').mockImplementation(async () => mapScVal);

      const score = await client.getReputationScore(TEST_PUBLIC_KEY);
      expect(score).toBe(92);
    });
  });

  describe('getTopPayers', () => {
    it('returns an empty array when the contract has no data', async () => {
      const emptyVec = xdr.ScVal.scvVec([]);

      const client = new ReputationClient('https://soroban-testnet.stellar.org', TEST_CONTRACT_ID);
      jest.spyOn(client as any, 'simulate').mockImplementation(async () => emptyVec);

      const result = await client.getTopPayers(10);
      expect(result).toEqual([]);
    });

    it('returns payer entries from a contract response', async () => {
      const payer1Addr = Keypair.random().publicKey();
      const payer2Addr = Keypair.random().publicKey();

      const vecScVal = xdr.ScVal.scvVec([
        makeScoreScVal({
          score: nativeToScVal(90, { type: 'u32' }),
          rank: nativeToScVal(1, { type: 'u32' }),
          address: nativeToScVal(payer1Addr, { type: 'symbol' }),
        }),
        makeScoreScVal({
          score: nativeToScVal(75, { type: 'u32' }),
          total_paid: nativeToScVal(3_000_000_000n, { type: 'i128' }),
          invoice_count: nativeToScVal(20, { type: 'u32' }),
          rank: nativeToScVal(2, { type: 'u32' }),
          address: nativeToScVal(payer2Addr, { type: 'symbol' }),
        }),
      ]);

      const client = new ReputationClient('https://soroban-testnet.stellar.org', TEST_CONTRACT_ID);
      jest.spyOn(client as any, 'simulate').mockImplementation(async () => vecScVal);

      const result = await client.getTopPayers(2);
      expect(result).toHaveLength(2);
    });
  });
});
