import { Command } from "commander";
import pc from "picocolors";
import Table from "cli-table3";
import { ILNSdk, AnalyticsSDK, createKeypairSigner } from "@iln/sdk";
import { loadConfig, saveConfig, ILNConfig } from "./config";
import { Keypair } from "@stellar/stellar-sdk";

// Constants
const STROOPS_PER_UNIT = 10_000_000n;

// Utility functions
export function parseDisplayAmount(input: string): bigint {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d{1,7}))?$/);
  if (!match) {
    throw new Error(
      "Invalid amount. Use a positive decimal value with up to 7 fractional digits (e.g. 100 or 12.5)."
    );
  }
  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(7, "0");
  return whole * STROOPS_PER_UNIT + BigInt(fraction);
}

export function formatAmount(stroops: bigint): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / STROOPS_PER_UNIT;
  const fraction = (absolute % STROOPS_PER_UNIT).toString().padStart(7, "0").replace(/0+$/, "");
  const rendered = fraction ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${rendered}` : rendered;
}

export function parseDueDate(input: string): number {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const isoValue = isoDateOnly ? `${trimmed}T23:59:59Z` : trimmed;
  const timestamp = Date.parse(isoValue);
  if (Number.isNaN(timestamp)) {
    throw new Error("Invalid due date. Use a Unix timestamp or an ISO date like YYYY-MM-DD.");
  }
  return Math.floor(timestamp / 1000);
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

function getSignerPublicKey(secretKey: string): string {
  try {
    return Keypair.fromSecret(secretKey).publicKey();
  } catch (error) {
    throw new Error("Invalid secret key format.");
  }
}

// SDK instantiation helper
function createSdkInstance(config: ILNConfig, requireSigner = false): ILNSdk {
  if (!config.contractId) {
    throw new Error(
      "Missing contract ID. Set `contractId` in ~/.iln/config.json or define the `ILN_CONTRACT_ID` environment variable."
    );
  }

  let signer;
  if (requireSigner) {
    if (!config.secretKey) {
      throw new Error(
        "Missing secret key. Set `secretKey` in ~/.iln/config.json or define the `ILN_SECRET_KEY` environment variable."
      );
    }
    signer = createKeypairSigner(config.secretKey);
  }

  return new ILNSdk({
    contractId: config.contractId,
    rpcUrl: config.rpcUrl!,
    networkPassphrase: config.networkPassphrase!,
    signer,
  });
}

function handleOutput(data: any, renderHuman: () => void, isJson: boolean) {
  if (isJson) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    renderHuman();
  }
}

export function registerCommands(program: Command) {
  // Invoice Subcommands
  const invoice = program
    .command("invoice")
    .description("Manage and interact with invoices");

  // iln invoice submit
  invoice
    .command("submit")
    .description("Submit a new invoice")
    .requiredOption("--payer <address>", "Stellar address of the payer")
    .requiredOption("--amount <amount>", "Invoice amount (e.g. 100 or 12.5)")
    .requiredOption("--due-date <date>", "Due date (Unix timestamp or YYYY-MM-DD)")
    .requiredOption("--discount-rate <rate>", "Discount rate in basis points (e.g., 300 for 3%)")
    .option("--freelancer <address>", "Stellar address of the freelancer (defaults to signer address)")
    .action(async (options) => {
      try {
        const config = loadConfig();
        const sdk = createSdkInstance(config, true);
        const freelancer = options.freelancer || getSignerPublicKey(config.secretKey!);

        const amountBigInt = parseDisplayAmount(options.amount);
        const dueSecs = parseDueDate(options.due_date);
        const discountRateInt = parseInt(options.discount_rate, 10);

        if (Number.isNaN(discountRateInt) || discountRateInt < 0) {
          throw new Error("Discount rate must be a non-negative integer.");
        }

        const invoiceId = await sdk.submitInvoice({
          freelancer,
          payer: options.payer,
          amount: amountBigInt,
          dueDate: dueSecs,
          discountRate: discountRateInt,
        });

        handleOutput(
          { success: true, invoiceId: invoiceId.toString() },
          () => {
            console.log(pc.green(`✓ Invoice submitted successfully. ID: ${invoiceId}`));
          },
          program.opts().json
        );
      } catch (err: any) {
        console.error(pc.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // iln invoice fund
  invoice
    .command("fund")
    .description("Fund an existing invoice")
    .requiredOption("--id <id>", "Invoice ID")
    .option("--funder <address>", "Stellar address of the funder (defaults to signer address)")
    .action(async (options) => {
      try {
        const config = loadConfig();
        const sdk = createSdkInstance(config, true);
        const funder = options.funder || getSignerPublicKey(config.secretKey!);
        const invoiceId = BigInt(options.id);

        await sdk.fundInvoice({
          funder,
          invoiceId,
        });

        handleOutput(
          { success: true, invoiceId: invoiceId.toString() },
          () => {
            console.log(pc.green(`✓ Invoice ${invoiceId} funded successfully.`));
          },
          program.opts().json
        );
      } catch (err: any) {
        console.error(pc.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // iln invoice pay
  invoice
    .command("pay")
    .description("Mark an invoice as paid")
    .requiredOption("--id <id>", "Invoice ID")
    .action(async (options) => {
      try {
        const config = loadConfig();
        const sdk = createSdkInstance(config, true);
        const invoiceId = BigInt(options.id);

        await sdk.markPaid({
          invoiceId,
        });

        handleOutput(
          { success: true, invoiceId: invoiceId.toString() },
          () => {
            console.log(pc.green(`✓ Invoice ${invoiceId} marked as paid.`));
          },
          program.opts().json
        );
      } catch (err: any) {
        console.error(pc.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // iln invoice get [id]
  invoice
    .command("get [id]")
    .description("Get details of a specific invoice")
    .action(async (id, options) => {
      try {
        if (!id) {
          throw new Error("Missing invoice ID.");
        }
        const config = loadConfig();
        const sdk = createSdkInstance(config);
        const invoiceId = BigInt(id);

        const data = await sdk.getInvoice(invoiceId);

        // Serialize bigint for output stability
        const serialized = {
          id: data.id.toString(),
          freelancer: data.freelancer,
          payer: data.payer,
          amount: data.amount.toString(),
          dueDate: data.dueDate,
          discountRate: data.discountRate,
          status: data.status,
          funder: data.funder,
          fundedAt: data.fundedAt,
        };

        handleOutput(
          serialized,
          () => {
            const table = new Table({
              head: [pc.cyan("Field"), pc.cyan("Value")],
              colWidths: [20, 60],
            });

            table.push(
              ["ID", serialized.id],
              ["Status", serialized.status],
              ["Amount", formatAmount(data.amount)],
              ["Discount Rate", `${serialized.discountRate} bps`],
              ["Due Date", formatTimestamp(serialized.dueDate)],
              ["Freelancer", serialized.freelancer],
              ["Payer", serialized.payer],
              ["Funder", serialized.funder || "-"],
              ["Funded At", serialized.fundedAt ? formatTimestamp(serialized.fundedAt) : "-"]
            );

            console.log(table.toString());
          },
          program.opts().json
        );
      } catch (err: any) {
        console.error(pc.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // iln invoice list
  invoice
    .command("list")
    .description("List all invoices (optionally filtered by address)")
    .option("--address <address>", "Filter by freelancer, payer, or funder address")
    .action(async (options) => {
      try {
        const config = loadConfig();
        const sdk = createSdkInstance(config);
        const count = await sdk.getInvoiceCount();
        const invoices = [];

        for (let i = 1n; i <= count; i++) {
          try {
            const inv = await sdk.getInvoice(i);
            if (options.address) {
              if (
                inv.freelancer === options.address ||
                inv.payer === options.address ||
                inv.funder === options.address
              ) {
                invoices.push(inv);
              }
            } else {
              invoices.push(inv);
            }
          } catch {
            // Skip failed/non-existent indexes
          }
        }

        const serialized = invoices.map((inv) => ({
          id: inv.id.toString(),
          freelancer: inv.freelancer,
          payer: inv.payer,
          amount: inv.amount.toString(),
          dueDate: inv.dueDate,
          discountRate: inv.discountRate,
          status: inv.status,
          funder: inv.funder,
          fundedAt: inv.fundedAt,
        }));

        handleOutput(
          serialized,
          () => {
            if (serialized.length === 0) {
              console.log("No invoices found.");
              return;
            }
            const table = new Table({
              head: [
                pc.cyan("ID"),
                pc.cyan("Status"),
                pc.cyan("Amount"),
                pc.cyan("Due Date"),
                pc.cyan("Freelancer"),
                pc.cyan("Payer"),
                pc.cyan("Funder"),
              ],
            });

            invoices.forEach((inv) => {
              table.push([
                inv.id.toString(),
                inv.status,
                formatAmount(inv.amount),
                formatTimestamp(inv.dueDate).slice(0, 10),
                inv.freelancer.slice(0, 8) + "...",
                inv.payer.slice(0, 8) + "...",
                inv.funder ? inv.funder.slice(0, 8) + "..." : "-",
              ]);
            });

            console.log(table.toString());
          },
          program.opts().json
        );
      } catch (err: any) {
        console.error(pc.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // iln stats
  program
    .command("stats")
    .description("Show protocol analytics/stats")
    .action(async () => {
      try {
        const config = loadConfig();
        const api = new AnalyticsSDK(
          config.network === "mainnet" ? "https://api.iln.network" : "http://localhost:3001"
        );
        const stats = await api.getProtocolStats();

        const serialized = {
          totalInvoices: stats.totalInvoices,
          totalVolume: stats.totalVolume.toString(),
          totalYield: stats.totalYield.toString(),
          defaultRate: stats.defaultRate,
        };

        handleOutput(
          serialized,
          () => {
            const table = new Table({
              head: [pc.cyan("Metric"), pc.cyan("Value")],
            });

            table.push(
              ["Total Invoices", serialized.totalInvoices],
              ["Total Volume", formatAmount(stats.totalVolume)],
              ["Total Yield", formatAmount(stats.totalYield)],
              ["Default Rate", `${(serialized.defaultRate * 100).toFixed(2)}%`]
            );

            console.log(table.toString());
          },
          program.opts().json
        );
      } catch (err: any) {
        console.error(pc.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // iln reputation get [address]
  const reputation = program
    .command("reputation")
    .description("Query user reputation score");

  reputation
    .command("get [address]")
    .description("Get the reputation score of an address")
    .action(async (address) => {
      try {
        const config = loadConfig();
        const targetAddress = address || (config.secretKey ? getSignerPublicKey(config.secretKey) : null);

        if (!targetAddress) {
          throw new Error("Missing address. Pass [address] or set `secretKey` in config.");
        }

        const sdk = createSdkInstance(config);
        const score = await sdk.getReputation(targetAddress);

        handleOutput(
          { address: targetAddress, score },
          () => {
            console.log(`${pc.bold(targetAddress)} Reputation Score: ${pc.cyan(score)}`);
          },
          program.opts().json
        );
      } catch (err: any) {
        console.error(pc.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // iln network switch [testnet|mainnet]
  const network = program
    .command("network")
    .description("Network settings");

  network
    .command("switch <target>")
    .description("Switch active network (testnet or mainnet)")
    .action(async (target) => {
      try {
        if (target !== "testnet" && target !== "mainnet") {
          throw new Error('Unsupported network. Choose either "testnet" or "mainnet".');
        }

        saveConfig({ network: target });

        handleOutput(
          { success: true, network: target },
          () => {
            console.log(pc.green(`✓ Active network successfully switched to ${target}.`));
          },
          program.opts().json
        );
      } catch (err: any) {
        console.error(pc.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });
}
