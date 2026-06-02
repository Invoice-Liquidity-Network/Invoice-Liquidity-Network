import {
  Account,
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  Asset,
} from '@stellar/stellar-sdk';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { ResolvedConfig } from './types';
import type { Ui } from './format';

export interface SeededAccount {
  name: 'freelancer' | 'payer' | 'liquidity_provider';
  publicKey: string;
  secretKey: string;
}

export interface SeederOptions {
  config: ResolvedConfig;
  ui: Ui;
  outputPath?: string;
}

// Known testnet token issuers
const TESTNET_TOKENS = {
  USDC: {
    code: 'USDC',
    issuer: 'GBUQWP3BOUZX34TBIGK5ILGKDFHTQCXY4IQ7ZLVTLZHVNCV3XVJVTSC',
  },
  EURC: {
    code: 'EURC',
    issuer: 'GCNY5OXYSY4FZLQS2B4J5NE6BNUL37AJQ4NZ4Prough6TWYJF6XZMFC',
  },
};

const FRIENDBOT_URL = 'https://friendbot.stellar.org/';

export class TestnetAccountSeeder {
  private readonly config: ResolvedConfig;
  private readonly ui: Ui;
  private readonly outputPath: string;
  private server: rpc.Server;

  constructor(options: SeederOptions) {
    this.config = options.config;
    this.ui = options.ui;
    this.outputPath = options.outputPath ?? path.join(process.cwd(), '.env.testnet.accounts');
    this.server = new rpc.Server(options.config.rpcUrl, {
      allowHttp: options.config.rpcUrl.startsWith('http://'),
    });
  }

  async seed(): Promise<SeededAccount[]> {
    // Check if we're on testnet
    if (this.config.network !== 'testnet') {
      throw new Error(
        `Account seeding is only available for testnet. Current network: ${this.config.network}`
      );
    }

    // Check for existing accounts
    const existing = this.loadExistingAccounts();
    if (existing.length === 3) {
      this.ui.info(
        '✓ Found existing seeded accounts. Seeder is idempotent - using existing accounts:'
      );
      this.printAccountsTable(existing);
      return existing;
    }

    this.ui.info('Creating 3 testnet accounts...');
    const accounts = this.generateAccounts();

    this.ui.info('Funding accounts via Friendbot...');
    await this.fundAccountsViaFriendbot(accounts);

    this.ui.info('Setting up USDC and EURC trustlines...');
    await this.setupTrustlines(accounts);

    // Save accounts to file
    this.saveAccounts(accounts);

    this.ui.success('✓ Testnet accounts seeded successfully!');
    this.printAccountsTable(accounts);
    this.ui.info('');
    this.ui.info('Next steps:');
    this.ui.info('  1. Accounts and keypairs are saved to: ' + this.outputPath);
    this.ui.info('  2. Test token balances can be minted using the Stellar Lab:');
    this.ui.info('     https://stellar.expert/');
    this.ui.info('  3. Or use the SDK to mint tokens if you have admin access');

    return accounts;
  }

  private generateAccounts(): SeededAccount[] {
    const accountTypes: Array<'freelancer' | 'payer' | 'liquidity_provider'> = [
      'freelancer',
      'payer',
      'liquidity_provider',
    ];

    return accountTypes.map((name) => {
      const keypair = Keypair.random();
      return {
        name,
        publicKey: keypair.publicKey(),
        secretKey: keypair.secret(),
      };
    });
  }

  private async fundAccountsViaFriendbot(accounts: SeededAccount[]): Promise<void> {
    for (const account of accounts) {
      try {
        const response = await fetch(`${FRIENDBOT_URL}?addr=${account.publicKey}`);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Friendbot returned ${response.status}: ${errorText}`);
        }
        await response.json(); // consume the response body
        this.ui.info(`  ✓ Funded ${account.name} with XLM`);
      } catch (error) {
        throw new Error(
          `Failed to fund ${account.name}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private async setupTrustlines(accounts: SeededAccount[]): Promise<void> {
    const tokens = Object.values(TESTNET_TOKENS);

    for (const account of accounts) {
      const keypair = Keypair.fromSecret(account.secretKey);

      try {
        // Get account information
        const accountData = await this.server.getAccount(account.publicKey);

        // Add trustline for each token
        for (const token of tokens) {
          const transaction = new TransactionBuilder(accountData, {
            fee: BASE_FEE,
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(
              Operation.changeTrust({
                asset: new Asset(token.code, token.issuer),
                limit: '922337203685.4775807', // Maximum limit for int64
              })
            )
            .setTimeout(30)
            .build();

          transaction.sign(keypair);

          try {
            const prepared = await this.server.prepareTransaction(transaction);
            const response = (await this.server.sendTransaction(prepared)) as {
              errorResultXdr?: string;
              hash?: string;
              status?: string;
            };

            if (response.status === 'PENDING' || response.status === 'DUPLICATE') {
              this.ui.info(`  ✓ Added ${token.code} trustline for ${account.name}`);
            } else {
              this.ui.warn(
                `  ⚠ Failed to add ${token.code} trustline for ${account.name}: ${response.status}`
              );
            }
          } catch (error) {
            // Check if the error is about trustline already existing
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes('op_already_exists') || errorMsg.includes('trust')) {
              this.ui.info(`  ✓ ${token.code} trustline already exists for ${account.name}`);
            } else {
              // Log warning but continue - some errors are recoverable
              this.ui.warn(
                `  ⚠ Issue setting up ${token.code} trustline for ${account.name}: ${errorMsg}`
              );
            }
          }
        }
      } catch (error) {
        this.ui.warn(
          `  ⚠ Could not set up trustlines for ${account.name}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private loadExistingAccounts(): SeededAccount[] {
    if (!existsSync(this.outputPath)) {
      return [];
    }

    try {
      const content = readFileSync(this.outputPath, 'utf-8');
      const envVars = this.parseEnvFile(content);

      const accountNames: Array<'freelancer' | 'payer' | 'liquidity_provider'> = [
        'freelancer',
        'payer',
        'liquidity_provider',
      ];

      const accounts: SeededAccount[] = [];

      for (const name of accountNames) {
        const publicKeyVar = `TESTNET_${name.toUpperCase()}_PUBLIC`;
        const secretKeyVar = `TESTNET_${name.toUpperCase()}_SECRET`;

        const publicKey = envVars[publicKeyVar];
        const secretKey = envVars[secretKeyVar];

        if (publicKey && secretKey) {
          accounts.push({
            name,
            publicKey,
            secretKey,
          });
        }
      }

      return accounts;
    } catch (error) {
      this.ui.warn(
        `Could not load existing accounts: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return [];
    }
  }

  private saveAccounts(accounts: SeededAccount[]): void {
    const envLines = [
      '# Generated testnet accounts - DO NOT COMMIT',
      '# Created for development purposes only',
      '# Testnet only - no real value',
      '',
    ];

    for (const account of accounts) {
      const suffix = account.name.toUpperCase();
      envLines.push(`TESTNET_${suffix}_PUBLIC=${account.publicKey}`);
      envLines.push(`TESTNET_${suffix}_SECRET=${account.secretKey}`);
      envLines.push('');
    }

    envLines.push('# Token contract addresses on Stellar testnet');
    for (const [symbol, token] of Object.entries(TESTNET_TOKENS)) {
      envLines.push(`TESTNET_${symbol}_ISSUER=${token.issuer}`);
    }

    writeFileSync(this.outputPath, envLines.join('\n'));
    this.ui.info(`✓ Saved account details to ${this.outputPath}`);
  }

  private parseEnvFile(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        result[key] = valueParts.join('=');
      }
    }

    return result;
  }

  private printAccountsTable(accounts: SeededAccount[]): void {
    const headers = ['Role', 'Public Key'];
    const rows = accounts.map((acc) => [
      acc.name.replace(/_/g, ' ').toUpperCase(),
      acc.publicKey.substring(0, 16) + '...' + acc.publicKey.substring(acc.publicKey.length - 10),
    ]);

    const widths = [20, 30];

    const renderRow = (cells: string[]) =>
      `  ${cells.map((c, i) => c.padEnd(widths[i])).join('  ')}`;

    this.ui.info('');
    this.ui.info(renderRow(headers));
    this.ui.info(renderRow(['─'.repeat(widths[0]), '─'.repeat(widths[1])]));

    for (const row of rows) {
      this.ui.info(renderRow(row));
    }
    this.ui.info('');
  }
}
