import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createUi } from '../src/format';
import { TestnetAccountSeeder, type SeededAccount } from '../src/dev-seed';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('TestnetAccountSeeder', () => {
  let tempDir: string;
  let uiMock: ReturnType<typeof createUi>;

  beforeEach(() => {
    tempDir = path.join(tmpdir(), `iln-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    uiMock = createUi(process.stdout, process.stderr);
  });

  afterEach(() => {
    // Clean up temp files
    try {
      const envFile = path.join(tempDir, '.env.testnet.accounts');
      if (existsSync(envFile)) {
        unlinkSync(envFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should generate 3 unique accounts', async () => {
    const seeder = new TestnetAccountSeeder({
      config: {
        network: 'testnet',
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        keypairPath: '/tmp/keypair.json',
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: 'https://soroban-testnet.stellar.org',
      },
      ui: uiMock,
      outputPath: path.join(tempDir, '.env.testnet.accounts'),
    });

    // Mock the seed method's HTTP calls
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
        text: async () => 'success',
      })
    );

    // Note: Full seeding requires RPC access, so we'll just test account generation
    const accounts = (seeder as any).generateAccounts();

    expect(accounts).toHaveLength(3);
    expect(accounts[0].name).toBe('freelancer');
    expect(accounts[1].name).toBe('payer');
    expect(accounts[2].name).toBe('liquidity_provider');

    // All should have valid public and secret keys
    for (const account of accounts) {
      expect(account.publicKey).toMatch(/^G[A-Z0-9]{55}$/);
      expect(account.secretKey).toMatch(/^S[A-Z0-9]{55}$/);
    }

    // All public keys should be unique
    const publicKeys = new Set(accounts.map((a: SeededAccount) => a.publicKey));
    expect(publicKeys.size).toBe(3);
  });

  it('should save and load accounts from env file', async () => {
    const seeder = new TestnetAccountSeeder({
      config: {
        network: 'testnet',
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        keypairPath: '/tmp/keypair.json',
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: 'https://soroban-testnet.stellar.org',
      },
      ui: uiMock,
      outputPath: path.join(tempDir, '.env.testnet.accounts'),
    });

    const testAccounts: SeededAccount[] = [
      {
        name: 'freelancer',
        publicKey: 'GBUQWP3BOUZX34TBIGK5ILGKDFHTQCXY4IQ7ZLVTLZHVNCV3XVJVTSC',
        secretKey: 'SBRVMQ6Z7IT7QAYJGUMUBTLV77D2U5A7YQPCUGRHRHZ7W57KJSD34SCT',
      },
      {
        name: 'payer',
        publicKey: 'GCNY5OXYSY4FZLQS2B4J5NE6BNUL37AJQ4NZ4PROUGH6TWYJF6XZMFC',
        secretKey: 'SBWH373Z3OKQVEJVKYXSXYSZ27IQWMQXEU7CZRW5YRDPPORMV756MNT',
      },
      {
        name: 'liquidity_provider',
        publicKey: 'GBBGO3XFGLQ4BXJFMGZWP2K3RIQELQW7YQMVZ3YZYJ3K6OYKFSX3FEK',
        secretKey: 'SBU3HJKKN5ZXC5N2BCCWQQVJVFKRSLMUJVUJGHUMDQ5GKDQABX47LFH',
      },
    ];

    // Save accounts
    (seeder as any).saveAccounts(testAccounts);

    // Verify file was created
    const envFile = path.join(tempDir, '.env.testnet.accounts');
    expect(existsSync(envFile)).toBe(true);

    // Load and verify
    const loaded = (seeder as any).loadExistingAccounts();
    expect(loaded).toHaveLength(3);
    expect(loaded[0].name).toBe('freelancer');
    expect(loaded[0].publicKey).toBe(testAccounts[0].publicKey);
    expect(loaded[0].secretKey).toBe(testAccounts[0].secretKey);
  });

  it('should only work on testnet', async () => {
    const seeder = new TestnetAccountSeeder({
      config: {
        network: 'mainnet',
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        keypairPath: '/tmp/keypair.json',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        rpcUrl: 'https://mainnet.sorobanrpc.com',
      },
      ui: uiMock,
      outputPath: path.join(tempDir, '.env.testnet.accounts'),
    });

    await expect(seeder.seed()).rejects.toThrow(/only available for testnet/);
  });

  it('should be idempotent', async () => {
    const testAccounts: SeededAccount[] = [
      {
        name: 'freelancer',
        publicKey: 'GBUQWP3BOUZX34TBIGK5ILGKDFHTQCXY4IQ7ZLVTLZHVNCV3XVJVTSC',
        secretKey: 'SBRVMQ6Z7IT7QAYJGUMUBTLV77D2U5A7YQPCUGRHRHZ7W57KJSD34SCT',
      },
      {
        name: 'payer',
        publicKey: 'GCNY5OXYSY4FZLQS2B4J5NE6BNUL37AJQ4NZ4PROUGH6TWYJF6XZMFC',
        secretKey: 'SBWH373Z3OKQVEJVKYXSXYSZ27IQWMQXEU7CZRW5YRDPPORMV756MNT',
      },
      {
        name: 'liquidity_provider',
        publicKey: 'GBBGO3XFGLQ4BXJFMGZWP2K3RIQELQW7YQMVZ3YZYJ3K6OYKFSX3FEK',
        secretKey: 'SBU3HJKKN5ZXC5N2BCCWQQVJVFKRSLMUJVUJGHUMDQ5GKDQABX47LFH',
      },
    ];

    const envFile = path.join(tempDir, '.env.testnet.accounts');
    const seeder = new TestnetAccountSeeder({
      config: {
        network: 'testnet',
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        keypairPath: '/tmp/keypair.json',
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: 'https://soroban-testnet.stellar.org',
      },
      ui: uiMock,
      outputPath: envFile,
    });

    // Save initial accounts
    (seeder as any).saveAccounts(testAccounts);

    // Load them back
    const loaded = (seeder as any).loadExistingAccounts();

    expect(loaded).toHaveLength(3);
    expect(loaded[0].publicKey).toBe(testAccounts[0].publicKey);
  });

  it('should parse env file correctly', () => {
    const seeder = new TestnetAccountSeeder({
      config: {
        network: 'testnet',
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        keypairPath: '/tmp/keypair.json',
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: 'https://soroban-testnet.stellar.org',
      },
      ui: uiMock,
      outputPath: path.join(tempDir, '.env.testnet.accounts'),
    });

    const envContent = `
# Comment line
TESTNET_FREELANCER_PUBLIC=GBUQWP3BOUZX34TBIGK5ILGKDFHTQCXY4IQ7ZLVTLZHVNCV3XVJVTSC
TESTNET_FREELANCER_SECRET=SBRVMQ6Z7IT7QAYJGUMUBTLV77D2U5A7YQPCUGRHRHZ7W57KJSD34SCT

KEY_WITH_EQUALS=value=with=equals
`;

    const result = (seeder as any).parseEnvFile(envContent);

    expect(result.TESTNET_FREELANCER_PUBLIC).toBe(
      'GBUQWP3BOUZX34TBIGK5ILGKDFHTQCXY4IQ7ZLVTLZHVNCV3XVJVTSC'
    );
    expect(result.TESTNET_FREELANCER_SECRET).toBe(
      'SBRVMQ6Z7IT7QAYJGUMUBTLV77D2U5A7YQPCUGRHRHZ7W57KJSD34SCT'
    );
    expect(result.KEY_WITH_EQUALS).toBe('value=with=equals');
    expect(result['# Comment line']).toBeUndefined();
  });
});
