import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `fetchOnChainReputation` against a mocked Soroban RPC.
 *
 * The function is deliberately total: every failure path returns a zeroed
 * snapshot rather than throwing, because a reputation lookup failing must
 * degrade the verdict's confidence, not take the verification endpoint down.
 * These cases pin that behaviour.
 */

const simulate = vi.fn();
const getAccount = vi.fn(async () => ({ accountId: () => 'GSOURCE', sequenceNumber: () => '1' }));
const scValToNative = vi.fn();

vi.mock('@stellar/stellar-sdk', async () => {
  class FakeAddress {
    constructor(public readonly value: string) {
      if (!value.startsWith('G')) throw new Error('invalid address');
    }
    toScVal() {
      return { address: this.value };
    }
  }

  return {
    Address: FakeAddress,
    BASE_FEE: '100',
    Contract: class {
      constructor(public readonly id: string) {}
      call(method: string, arg: unknown) {
        return { method, arg };
      }
    },
    Keypair: { random: () => ({ publicKey: () => 'GRANDOMSOURCE' }) },
    Networks: { TESTNET: 'Test SDF Network ; September 2015' },
    TransactionBuilder: class {
      constructor(
        public readonly account: unknown,
        public readonly opts: unknown
      ) {}
      addOperation() {
        return this;
      }
      setTimeout() {
        return this;
      }
      build() {
        return { tx: true };
      }
    },
    nativeToScVal: vi.fn(),
    rpc: {
      Server: class {
        getAccount = getAccount;
        simulateTransaction = simulate;
      },
    },
    scValToNative,
    xdr: {},
  };
});

const { fetchOnChainReputation } = await import('./verifier');

const options = { rpcUrl: 'https://rpc.example', contractId: 'CCONTRACT' };
const address = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';

const ZEROED = {
  address,
  score: 0,
  totalPaid: 0n,
  invoiceCount: 0,
  lastActivity: 0,
  rank: 0,
};

beforeEach(() => {
  simulate.mockReset();
  scValToNative.mockReset();
  getAccount.mockClear();
});

describe('fetchOnChainReputation', () => {
  it('maps a plain-object return value into a snapshot', async () => {
    simulate.mockResolvedValue({ result: { retval: {} } });
    scValToNative.mockReturnValue({
      score: 82,
      total_paid: '5000000',
      invoice_count: 9,
      last_activity: 1_700_000_000,
      rank: 4,
    });

    expect(await fetchOnChainReputation(options, address)).toEqual({
      address,
      score: 82,
      totalPaid: 5_000_000n,
      invoiceCount: 9,
      lastActivity: 1_700_000_000,
      rank: 4,
    });
  });

  it('maps a Map return value the same way', async () => {
    simulate.mockResolvedValue({ result: { retval: {} } });
    scValToNative.mockReturnValue(
      new Map<string, unknown>([
        ['score', 55],
        ['total_paid', '250'],
        ['invoice_count', 3],
        ['last_activity', 1_700_000_500],
        ['rank', 12],
      ])
    );

    const snapshot = await fetchOnChainReputation(options, address);

    expect(snapshot.score).toBe(55);
    expect(snapshot.totalPaid).toBe(250n);
    expect(snapshot.rank).toBe(12);
  });

  it('defaults every missing field to zero', async () => {
    simulate.mockResolvedValue({ result: { retval: {} } });
    scValToNative.mockReturnValue({});

    expect(await fetchOnChainReputation(options, address)).toEqual(ZEROED);
  });

  it('clamps negative values to zero', async () => {
    simulate.mockResolvedValue({ result: { retval: {} } });
    scValToNative.mockReturnValue({ score: -10, invoice_count: -3, last_activity: -1, rank: -7 });

    const snapshot = await fetchOnChainReputation(options, address);

    expect(snapshot.score).toBe(0);
    expect(snapshot.invoiceCount).toBe(0);
    expect(snapshot.lastActivity).toBe(0);
    expect(snapshot.rank).toBe(0);
  });

  it('handles a non-object native return value', async () => {
    simulate.mockResolvedValue({ result: { retval: {} } });
    scValToNative.mockReturnValue(null);

    expect(await fetchOnChainReputation(options, address)).toEqual(ZEROED);
  });

  it('returns a zeroed snapshot when the simulation reports an error', async () => {
    simulate.mockResolvedValue({ error: 'contract not found' });

    expect(await fetchOnChainReputation(options, address)).toEqual(ZEROED);
  });

  it('returns a zeroed snapshot when the simulation has no return value', async () => {
    simulate.mockResolvedValue({ result: {} });

    expect(await fetchOnChainReputation(options, address)).toEqual(ZEROED);
  });

  it('returns a zeroed snapshot when the result is absent entirely', async () => {
    simulate.mockResolvedValue({});

    expect(await fetchOnChainReputation(options, address)).toEqual(ZEROED);
  });

  it('returns a zeroed snapshot when the RPC call throws', async () => {
    simulate.mockRejectedValue(new Error('network down'));

    expect(await fetchOnChainReputation(options, address)).toEqual(ZEROED);
  });

  it('returns a zeroed snapshot for an unparseable address', async () => {
    expect(await fetchOnChainReputation(options, 'not-an-address')).toEqual({
      ...ZEROED,
      address: 'not-an-address',
    });
  });

  it('uses the supplied source account and network passphrase when given', async () => {
    simulate.mockResolvedValue({ result: { retval: {} } });
    scValToNative.mockReturnValue({});

    await fetchOnChainReputation(
      { ...options, source: 'GEXPLICITSOURCE', networkPassphrase: 'Custom Passphrase' },
      address
    );

    expect(getAccount).toHaveBeenCalledWith('GEXPLICITSOURCE');
  });

  it('falls back to a random source account when none is supplied', async () => {
    simulate.mockResolvedValue({ result: { retval: {} } });
    scValToNative.mockReturnValue({});

    await fetchOnChainReputation(options, address);

    expect(getAccount).toHaveBeenCalledWith('GRANDOMSOURCE');
  });
});
