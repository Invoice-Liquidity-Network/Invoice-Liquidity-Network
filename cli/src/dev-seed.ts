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
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ResolvedConfig } from "./types";
import type { Ui } from "./format";
import { createProgressBar } from "./progress";

export interface SeededAccount {
  name: "freelancer" | "payer" | "liquidity_provider";
  publicKey: string;
  secretKey: string;
}

export interface SeedOptions {
  scenario?: string;
  count?: number;
  token?: string;
}

export interface SeederOptions {
  config: ResolvedConfig;
  ui: Ui;
  outputPath?: string;
}

const VALID_SCENARIOS = ["new-user", "active-lp", "disputed"];

// Known testnet token issuers
const TESTNET_TOKENS = {
  USDC: {
    code: "USDC",
    issuer: "GBUQWP3BOUZX34TBIGK5ILGKDFHTQCXY4IQ7ZLVTLZHVNCV3XVJVTSC",
  },
  EURC: {
    code: "EURC",
    issuer: "GCNY5OXYSY4FZLQS2B4J5NE6BNUL37AJQ4NZ4Prough6TWYJF6XZMFC",
  },
};

const FRIENDBOT_URL = "https://friendbot.stellar.org/";

export class TestnetAccountSeeder {
  private readonly config: ResolvedConfig;
  private readonly ui: Ui;
  private readonly outputPath: string;
  private server: rpc.Server;

  constructor(options: SeederOptions) {
    this.config = options.config;
    this.ui = options.ui;
    this.outputPath = options.outputPath ?? path.join(process.cwd(), ".env.testnet.accounts");
    this.server = new rpc.Server(options.config.rpcUrl, {
      allowHttp: options.config.rpcUrl.startsWith("http://"),
    });
  }

  async seed(options?: SeedOptions): Promise<SeededAccount[]> {
    const scenario = options?.scenario;
    const count = options?.count ?? 1;
    const tokenFilter = options?.token?.toUpperCase();

    if (scenario && !VALID_SCENARIOS.includes(scenario)) {
      throw new Error(`Invalid scenario: ${scenario}. Must be one of: ${VALID_SCENARIOS.join(", ")}`);
    }

    if (tokenFilter && !TESTNET_TOKENS[tokenFilter as keyof typeof TESTNET_TOKENS]) {
      throw new Error(`Invalid token: ${tokenFilter}. Must be one of: ${Object.keys(TESTNET_TOKENS).join(", ")}`);
    }

    if (this.config.network !== "testnet") {
      throw new Error(`Account seeding is only available for testnet. Current network: ${this.config.network}`);
    }

    const effectiveScenario = scenario ?? "new-user";
    this.ui.info(`Scenario: ${effectiveScenario} | Count: ${count}${tokenFilter ? ` | Token: ${tokenFilter}` : ""}`);

    const totalSteps = effectiveScenario === "new-user" ? 4 : 6;
    const bar = createProgressBar(totalSteps, "Seeding testnet accounts", { enabled: false });

    const step = (msg: string) => {
      bar.increment(1, msg);
    };

    const existing = this.loadExistingAccounts();
    let accounts: SeededAccount[];

    if (existing.length === 3) {
      step("Found existing seeded accounts, reusing them");
      accounts = existing;
    } else {
      step("Creating 3 testnet accounts");
      accounts = this.generateAccounts();

      step("Funding accounts via Friendbot");
      await this.fundAccountsViaFriendbot(accounts);

      step("Setting up trustlines");
      await this.setupTrustlines(accounts, tokenFilter);

      this.saveAccounts(accounts);
    }

    if (effectiveScenario === "active-lp" || effectiveScenario === "disputed") {
      step("Submitting and funding invoices for scenario");
      await this.seedScenarioInvoices(accounts, effectiveScenario, count, tokenFilter);
    }

    bar.succeed(`Seeding complete (${effectiveScenario}, ${count} record(s))`);
    this.printAccountsTable(accounts);

    return accounts;
  }

  private async seedScenarioInvoices(
    accounts: SeededAccount[],
    scenario: string,
    count: number,
    tokenFilter?: string
  ): Promise<void> {
    const freelancer = accounts.find((a) => a.name === "freelancer")!;
    const payer = accounts.find((a) => a.name === "payer")!;
    const lp = accounts.find((a) => a.name === "liquidity_provider")!;

    const server = new rpc.Server(this.config.rpcUrl, {
      allowHttp: this.config.rpcUrl.startsWith("http://"),
    });

    const tokenId = tokenFilter
      ? TESTNET_TOKENS[tokenFilter as keyof typeof TESTNET_TOKENS]?.issuer
        ? this.config.contractId
        : this.config.contractId
      : this.config.contractId;

    for (let i = 0; i < count; i++) {
      this.ui.info(`  Seeding record ${i + 1}/${count}...`);

      const freelancerKp = Keypair.fromSecret(freelancer.secretKey);
      const freelancerAcct = await server.getAccount(freelancer.publicKey);

      const dueDate = Math.floor(Date.now() / 1000) + 7 * 86400;
      const amount = BigInt(1000 * (i + 1));
      const discountRate = 300;

      try {
        const submitTx = new TransactionBuilder(freelancerAcct, {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            Operation.invokeContractFunction({
              contract: this.config.contractId,
              function: "submit_invoice",
              args: [
                Address.fromString(payer.publicKey).toScVal(),
                Address.fromString(freelancer.publicKey).toScVal(),
                nativeToScVal(amount, { type: "i128" }),
                nativeToScVal(BigInt(dueDate), { type: "u64" }),
                nativeToScVal(discountRate, { type: "u32" }),
                Address.fromString(this.config.contractId).toScVal(),
              ],
            }),
          )
          .setTimeout(60)
          .build();

        submitTx.sign(freelancerKp);
        const prepared = await server.prepareTransaction(submitTx);
        const result = (await server.sendTransaction(prepared)) as {
          hash?: string;
          status?: string;
        };

        if (result.status === "PENDING" || result.status === "DUPLICATE") {
          this.ui.info(`    Submitted invoice ${i + 1}`);
        } else {
          this.ui.warn(`    Invoice submission status: ${result.status}`);
        }
      } catch (error) {
        this.ui.warn(`    Invoice submission for record ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (scenario === "active-lp") {
      this.ui.info("  LP scenario: accounts configured with active liquidity provider role");
    } else if (scenario === "disputed") {
      this.ui.info("  Disputed scenario: accounts configured with dispute resolution state");
    }
  }

  private generateAccounts(): SeededAccount[] {
    const accountTypes: Array<"freelancer" | "payer" | "liquidity_provider"> = [
      "freelancer",
      "payer",
      "liquidity_provider",
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
          `Failed to fund ${account.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async setupTrustlines(accounts: SeededAccount[], tokenFilter?: string): Promise<void> {
    const tokens = tokenFilter
      ? [TESTNET_TOKENS[tokenFilter as keyof typeof TESTNET_TOKENS]].filter(Boolean)
      : Object.values(TESTNET_TOKENS);

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
                limit: "922337203685.4775807", // Maximum limit for int64
              }),
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

            if (response.status === "PENDING" || response.status === "DUPLICATE") {
              this.ui.info(`  ✓ Added ${token.code} trustline for ${account.name}`);
            } else {
              this.ui.warn(`  ⚠ Failed to add ${token.code} trustline for ${account.name}: ${response.status}`);
            }
          } catch (error) {
            // Check if the error is about trustline already existing
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes("op_already_exists") || errorMsg.includes("trust")) {
              this.ui.info(`  ✓ ${token.code} trustline already exists for ${account.name}`);
            } else {
              // Log warning but continue - some errors are recoverable
              this.ui.warn(
                `  ⚠ Issue setting up ${token.code} trustline for ${account.name}: ${errorMsg}`,
              );
            }
          }
        }
      } catch (error) {
        this.ui.warn(
          `  ⚠ Could not set up trustlines for ${account.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private loadExistingAccounts(): SeededAccount[] {
    if (!existsSync(this.outputPath)) {
      return [];
    }

    try {
      const content = readFileSync(this.outputPath, "utf-8");
      const envVars = this.parseEnvFile(content);

      const accountNames: Array<"freelancer" | "payer" | "liquidity_provider"> = [
        "freelancer",
        "payer",
        "liquidity_provider",
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
      this.ui.warn(`Could not load existing accounts: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private saveAccounts(accounts: SeededAccount[]): void {
    const envLines = [
      "# Generated testnet accounts - DO NOT COMMIT",
      "# Created for development purposes only",
      "# Testnet only - no real value",
      "",
    ];

    for (const account of accounts) {
      const suffix = account.name.toUpperCase();
      envLines.push(`TESTNET_${suffix}_PUBLIC=${account.publicKey}`);
      envLines.push(`TESTNET_${suffix}_SECRET=${account.secretKey}`);
      envLines.push("");
    }

    envLines.push("# Token contract addresses on Stellar testnet");
    for (const [symbol, token] of Object.entries(TESTNET_TOKENS)) {
      envLines.push(`TESTNET_${symbol}_ISSUER=${token.issuer}`);
    }

    writeFileSync(this.outputPath, envLines.join("\n"));
    this.ui.info(`✓ Saved account details to ${this.outputPath}`);
  }

  private parseEnvFile(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        result[key] = valueParts.join("=");
      }
    }

    return result;
  }

  private printAccountsTable(accounts: SeededAccount[]): void {
    const headers = ["Role", "Public Key"];
    const rows = accounts.map((acc) => [
      acc.name.replace(/_/g, " ").toUpperCase(),
      acc.publicKey.substring(0, 16) + "..." + acc.publicKey.substring(acc.publicKey.length - 10),
    ]);

    const widths = [20, 30];

    const renderRow = (cells: string[]) => `  ${cells.map((c, i) => c.padEnd(widths[i])).join("  ")}`;

    this.ui.info("");
    this.ui.info(renderRow(headers));
    this.ui.info(renderRow(["─".repeat(widths[0]), "─".repeat(widths[1])]));

    for (const row of rows) {
      this.ui.info(renderRow(row));
    }
    this.ui.info("");
  }
}
