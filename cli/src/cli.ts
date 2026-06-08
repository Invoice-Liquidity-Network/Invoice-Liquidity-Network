#!/usr/bin/env node
import { Address, StrKey } from "@stellar/stellar-sdk";
import { Command } from "commander";

import { parseDisplayAmount } from "./amounts";
import { ILNClient } from "./client";
import { loadConfig } from "./config";
import { parseDueDate } from "./dates";
import { LocalDevEnvironment } from "./dev-environment";
import { formatUnknownError } from "./errors";
import { decodeScValXdr, formatDecodedScVal } from "./xdr";
import {
  createUi,
  describeConfig,
  formatInvoiceDetails,
  formatInvoiceList,
  formatProtocolConfig,
} from "./format";
import { registerInspectCommand } from "./inspect";
import { createKeypairFileSigner } from "./signer";
import { TestnetAccountSeeder } from "./dev-seed";
import type { Ui } from "./format";
import type { ResolvedConfig, RpcServerLike } from "./types";

import { checkCompatibility } from "@invoice-liquidity/sdk";

export interface CliDependencies {
  createClient(config: ResolvedConfig): ILNClient;
  createDevEnvironment?(ui: Ui): Pick<LocalDevEnvironment, "reset" | "start" | "status" | "stop">;
  loadConfig(options?: { cwd?: string; env?: NodeJS.ProcessEnv }): ResolvedConfig;
  stderr: NodeJS.WritableStream;
  stdout: NodeJS.WritableStream;
}

export async function runCli(
  argv: string[],
  dependencies: Partial<CliDependencies> = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const ui = createUi(stdout, stderr);
  const load = dependencies.loadConfig ?? loadConfig;
  const createClient =
    dependencies.createClient ??
    ((config: ResolvedConfig) => new ILNClient({
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
      signer: createKeypairFileSigner(config.keypairPath),
    }));
  const createDevEnvironment =
    dependencies.createDevEnvironment ??
    ((devUi: Ui) => new LocalDevEnvironment({ ui: devUi }));

  const program = new Command();
  program
    .name("iln")
    .description("Invoice Liquidity Network CLI")
    .exitOverride()
    .showHelpAfterError()
    .option("--json", "reserved for future machine-readable output")
    .hook("preAction", (_thisCommand, actionCommand) => {
      const isConfiglessXdrCommand =
        actionCommand.name() === "decode" && actionCommand.parent?.name() === "xdr";
      if (
        isConfiglessXdrCommand ||
        (actionCommand.parent?.name() === "dev" &&
          ["reset", "start", "status", "stop"].includes(actionCommand.name()))
      ) {
        return;
      }

      try {
        const config = load();
        ui.info(`Using ${describeConfig(config)}`);
      } catch (error) {
        throw error;
      }
    });

  program
    .command("submit")
    .description("Submit a new invoice from the configured signer account.")
    .requiredOption("--payer <address>", "payer Stellar address")
    .requiredOption("--amount <amount>", "invoice amount in display units, for example 100 or 12.5")
    .requiredOption("--due <date>", "due date as YYYY-MM-DD or Unix timestamp")
    .requiredOption("--rate <bps>", "discount rate in basis points")
    .option("--token <contractId>", "override token contract ID from config")
    .action(async (options: { amount: string; due: string; payer: string; rate: string; token?: string }) => {
      const config = load();
      const client = createClient(config);
      const tokenId = options.token ?? config.tokenId;
      if (!tokenId) {
        throw new Error(
          "Missing token ID. Set `tokenId` in .iln.json, set `ILN_TOKEN_ID`, or pass `--token`.",
        );
      }

      assertStellarAddress(options.payer, "payer");
      assertContractId(tokenId, "token");

      const { invoiceId, txHash } = await client.submitInvoice({
        amount: parseDisplayAmount(options.amount),
        discountRate: parseBasisPoints(options.rate),
        dueDate: parseDueDate(options.due),
        payer: options.payer,
        tokenId,
      });

      ui.success(`Submitted invoice ${invoiceId.toString()} in transaction ${txHash}.`);
    });

  program
    .command("fund")
    .description("Fund an invoice using the configured signer account.")
    .requiredOption("--id <invoiceId>", "invoice ID")
    .option("--amount <amount>", "amount to fund in display units; defaults to the remaining balance")
    .action(async (options: { amount?: string; id: string }) => {
      const client = createClient(load());
      const result = await client.fundInvoice(
        parseInvoiceId(options.id),
        options.amount ? parseDisplayAmount(options.amount) : undefined,
      );
      ui.success(`Funded invoice ${options.id} in transaction ${result.hash}.`);
    });

  program
    .command("pay")
    .description("Mark an invoice as paid using the configured signer account.")
    .requiredOption("--id <invoiceId>", "invoice ID")
    .action(async (options: { id: string }) => {
      const client = createClient(load());
      const result = await client.markPaid(parseInvoiceId(options.id));
      ui.success(`Marked invoice ${options.id} as paid in transaction ${result.hash}.`);
    });

  program
    .command("status")
    .description("Show the current state of an invoice.")
    .requiredOption("--id <invoiceId>", "invoice ID")
    .action(async (options: { id: string }) => {
      const client = createClient(load());
      const invoice = await client.getInvoice(parseInvoiceId(options.id));
      ui.info(formatInvoiceDetails(invoice));
    });

  program
    .command("list")
    .description("List all invoices associated with a Stellar address.")
    .requiredOption("--address <address>", "freelancer, payer, or funder Stellar address")
    .action(async (options: { address: string }) => {
      assertStellarAddress(options.address, "address");
      const client = createClient(load());
      const invoices = await client.listInvoicesByAddress(options.address);
      ui.info(formatInvoiceList(invoices));
    });

  // Compatibility check command
  const compatCommand = program.command("compat").description("SDK and contract compatibility utilities");

  compatCommand
    .command("check")
    .description("Check SDK compatibility with the deployed contract version.")
    .action(async () => {
      const config = load();
      const client = createClient(config);
      
      ui.info("Checking contract compatibility...");
      const result = await checkCompatibility(async (method: string) => {
        if (method === "get_version") {
          return client.getVersion();
        }
        throw new Error(`Unsupported compatibility check invoke method: ${method}`);
      });

      ui.info(`SDK Version:      ${result.sdkVersion}`);
      ui.info(`Contract Version: ${result.contractVersion}`);
      
      if (result.compatible) {
        ui.success("Compatibility check passed! The SDK is fully compatible with the deployed contract.");
      } else {
        ui.error("Compatibility check failed!");
        result.issues.forEach((issue) => {
          ui.error(` - ${issue}`);
        });
        throw new Error("Compatibility check failed.");
      }
    });

  program
    .command("config")
    .description("Show live protocol configuration from the ILN contract.")
    .action(async () => {
      const client = createClient(load());
      const config = await client.getProtocolConfig();
      ui.info(formatProtocolConfig(config));
    });

  const xdrCommand = program.command("xdr").description("Inspect Soroban XDR values");

  xdrCommand
    .command("decode")
    .description("Decode a base64 Soroban ScVal XDR value.")
    .argument("[base64]", "base64-encoded ScVal XDR")
    .action((base64?: string) => {
      if (!base64) {
        throw new Error("Missing base64 ScVal XDR. Usage: iln xdr decode <base64>");
      }

      stdout.write(formatDecodedScVal(decodeScValXdr(base64)));
    });

  // Development commands
  const devCommand = program.command("dev").description("Development utilities");

  devCommand
    .command("start")
    .description("Start a local Stellar node, deploy contracts, fund accounts, and write .env.local.")
    .action(async () => {
      await createDevEnvironment(ui).start();
    });

  devCommand
    .command("stop")
    .description("Stop and remove the local Stellar node container.")
    .action(async () => {
      await createDevEnvironment(ui).stop();
    });

  devCommand
    .command("reset")
    .description("Stop, clear local state, and start a fresh local environment.")
    .action(async () => {
      await createDevEnvironment(ui).reset();
    });

  devCommand
    .command("status")
    .description("Show local node, contract, and account environment status.")
    .action(async () => {
      await createDevEnvironment(ui).status();
    });

  devCommand
    .command("seed")
    .description("Create and fund testnet accounts with USDC/EURC trustlines for development.")
    .action(async () => {
      const config = load();
      const seeder = new TestnetAccountSeeder({ config, ui });
      await seeder.seed();
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    ui.error(formatUnknownError(error));
    return 1;
  }
}

export async function main(): Promise<void> {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

function parseInvoiceId(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error("Invoice ID must be a positive integer.");
  }

  return BigInt(value);
}

function parseBasisPoints(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("Discount rate must be an integer basis-point value.");
  }

  return Number(value);
}

function assertStellarAddress(value: string, field: string): void {
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw new Error(`Invalid ${field} address: ${value}`);
  }
}

function assertContractId(value: string, field: string): void {
  try {
    Address.fromString(value);
  } catch {
    throw new Error(`Invalid ${field} contract ID: ${value}`);
  }
}
