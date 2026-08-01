#!/usr/bin/env node
import { Address, StrKey } from "@stellar/stellar-sdk";
import { Command } from "commander";

import { parseDisplayAmount } from "./amounts";
import { ILNClient } from "./client";
import { loadConfig, initConfig } from "./config";
import { parseDueDate } from "./dates";
import { LocalDevEnvironment } from "./dev-environment";
import { formatUnknownError } from "./errors";
import { decodeScValXdr, formatDecodedScVal } from "./xdr";
import {
  createUi,
  describeConfig,
  formatHistoryJson,
  formatHistoryTable,
  formatInvoiceDetails,
  formatInvoiceDetailsJson,
  formatInvoiceList,
  formatInvoiceListJson,
  formatProtocolConfig,
  formatProtocolConfigJson,
  helpExample,
  helpSection,
} from "./format";
import { generateManPage } from "./man";
import { registerInspectCommand } from "./inspect";
import { registerCompletionCommand } from "./completion";
import { registerEnvCommands } from "./env";
import {
  promptMissingArguments,
  validateStellarAddress,
  validatePositiveNumber,
  validateBasisPoints,
  validateDate,
} from "./prompts";
import { createKeypairFileSigner } from "./signer";
import { TestnetAccountSeeder } from "./dev-seed";
import {
  createWallet,
  importWallet,
  listWallets,
  deleteWallet,
  fundWalletFromFriendbot,
} from "./wallet";
import type { Ui } from "./format";
import type { ResolvedConfig, RpcServerLike } from "./types";

import { checkCompatibility } from "@iln/sdk";
import { runInteractive } from "./interactive";
import { VersionManager } from "./version";
import { runTutorial } from "./tutorial";

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

  program.configureOutput({
    writeOut: (str) => stdout.write(str),
    writeErr: (str) => stderr.write(str),
  });

  program.configureHelp({
    formatHelp: (cmd, helper) => {
      const pc = require("picocolors");
      const term = (str: string) => pc.bold(pc.cyan(str));
      const sections: string[] = [];

      const usage = helper.commandUsage(cmd);
      if (usage) sections.push(`${pc.bold("Usage:")} ${usage}`);

      const description = helper.commandDescription(cmd);
      if (description) sections.push(`\n${description}`);

      const args = helper.visibleArguments(cmd);
      if (args.length) {
        sections.push(`\n${pc.bold("Arguments:")}`);
        args.forEach((a) =>
          sections.push(`  ${term(helper.argumentTerm(a).padEnd(helper.padWidth(cmd, helper)))}  ${helper.argumentDescription(a)}`),
        );
      }

      const opts = helper.visibleOptions(cmd);
      if (opts.length) {
        sections.push(`\n${pc.bold("Options:")}`);
        opts.forEach((o) =>
          sections.push(`  ${term(helper.optionTerm(o).padEnd(helper.padWidth(cmd, helper)))}  ${helper.optionDescription(o)}`),
        );
      }

      const cmds = helper.visibleCommands(cmd);
      if (cmds.length) {
        sections.push(`\n${pc.bold("Commands:")}`);
        cmds.forEach((c) =>
          sections.push(`  ${term(helper.subcommandTerm(c).padEnd(helper.padWidth(cmd, helper)))}  ${helper.subcommandDescription(c)}`),
        );
      }

      return sections.join("\n") + "\n";
    },
  });

  const versionManager = new VersionManager(ui);

  program
    .name("iln")
    .version(versionManager.getCurrentVersion(), "-v, --version", "output the current version")
    .description("Invoice Liquidity Network CLI")
    .exitOverride()
    .showHelpAfterError()
    .option("--json", "output machine-readable JSON (applies to: status, list)")
    .option("--quiet", "suppress informational messages; show only command output")
    .hook("preAction", (_thisCommand, actionCommand) => {
      registerCompletionCommand(program);
      registerEnvCommands(program);

      const isConfiglessXdrCommand =
        actionCommand.name() === "decode" && actionCommand.parent?.name() === "xdr";
      if (
        actionCommand.name() === "man" ||
        isConfiglessXdrCommand ||
        (actionCommand.parent?.name() === "dev" &&
          ["reset", "start", "status", "stop"].includes(actionCommand.name()))
      ) {
        return;
      }

      try {
        const config = load();
        const opts = program.opts() as { quiet?: boolean };
        if (!opts.quiet) {
          ui.info(`Using ${describeConfig(config)}`);
        }

        // --- Version Management ---
        const currentVersion = versionManager.getCurrentVersion();
        
        // 1. Version Pinning
        if (config.requiredVersion && config.requiredVersion !== currentVersion) {
          throw new Error(
            `Version mismatch: This project requires ILN CLI version ${config.requiredVersion}, but you are running ${currentVersion}.`,
          );
        }

        // 2. Update Check
        if (config.autoUpdate && !opts.quiet) {
          // Fire and forget update check to not block startup significantly
          void versionManager.notifyUpdateIfAvailable();
        }
      } catch (error) {
        throw error;
      }
    });

  program
    .command("submit")
    .description("Submit a new invoice from the configured signer account.")
    .option("--payer <address>", "payer Stellar address")
    .option("--amount <amount>", "invoice amount in display units, for example 100 or 12.5")
    .option("--due <date>", "due date as YYYY-MM-DD or Unix timestamp")
    .option("--rate <bps>", "discount rate in basis points")
    .option("--token <contractId>", "override token contract ID from config")
    .option("--yes", "skip interactive prompts and use defaults")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln submit --payer GABC... --amount 100 --due 2026-03-31 --rate 300"),
        helpExample("iln submit --payer GABC... --amount 12.5 --due 2026-06-15 --rate 150 --token CDEF..."),
        "",
        helpSection("See also:"),
        helpExample("iln status --id <id>    Check the state of a submitted invoice"),
        helpExample("iln list --address <G>  List all invoices for your address"),
      ].join("\n"),
    )
    .action(async (options: { amount?: string; due?: string; payer?: string; rate?: string; token?: string; yes?: boolean }) => {
      const config = load();
      const client = createClient(config);
      const tokenId = options.token ?? config.tokenId;
      if (!tokenId) {
        throw new Error(
          "Missing token ID. Set `tokenId` in .iln.json, set `ILN_TOKEN_ID`, or pass `--token`.",
        );
      }

      // Prompt for missing required arguments in interactive mode
      let payer = options.payer;
      let amount = options.amount;
      let due = options.due;
      let rate = options.rate;

      if (!options.yes && process.stdin.isTTY) {
        const resolved = await promptMissingArguments(
          [
            {
              name: "payer",
              description: "Payer Stellar address (G...)",
              required: true,
              validate: validateStellarAddress,
            },
            {
              name: "amount",
              description: "Invoice amount in display units (e.g. 100 or 12.5)",
              required: true,
              validate: validatePositiveNumber,
            },
            {
              name: "due",
              description: "Due date as YYYY-MM-DD or Unix timestamp",
              required: true,
              validate: validateDate,
            },
            {
              name: "rate",
              description: "Discount rate in basis points (e.g. 500 = 5%)",
              required: true,
              defaultValue: "500",
              validate: validateBasisPoints,
            },
          ],
          { payer, amount, due, rate },
        );

        payer = resolved.payer;
        amount = resolved.amount;
        due = resolved.due;
        rate = resolved.rate;
      }

      if (!payer || !amount || !due || !rate) {
        throw new Error("Missing required arguments. Use --payer, --amount, --due, --rate or run interactively.");
      }

      assertStellarAddress(payer, "payer");
      assertContractId(tokenId, "token");

      const { invoiceId, txHash } = await client.submitInvoice({
        amount: parseDisplayAmount(amount),
        discountRate: parseBasisPoints(rate),
        dueDate: parseDueDate(due),
        payer,
        tokenId,
      });

      const globalOpts = program.opts() as { json?: boolean };
      if (globalOpts.json) {
        stdout.write(JSON.stringify({ success: true, invoiceId: invoiceId.toString(), txHash }, null, 2) + "\n");
      } else {
        ui.success(`Submitted invoice ${invoiceId.toString()} in transaction ${txHash}.`);
      }
    });

  program
    .command("fund")
    .description("Fund an invoice using the configured signer account.")
    .option("--id <invoiceId>", "invoice ID")
    .option("--amount <amount>", "amount to fund in display units; defaults to the remaining balance")
    .option("--yes", "skip interactive prompts and use defaults")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln fund --id 42"),
        helpExample("iln fund --id 42 --amount 50   (partial funding)"),
        "",
        helpSection("See also:"),
        helpExample("iln status --id <id>    Confirm the invoice is now Funded"),
        helpExample("iln history --address <G>  View your funding history"),
      ].join("\n"),
    )
    .action(async (options: { amount?: string; id?: string; yes?: boolean }) => {
      let invoiceId = await resolveIdFromStdin(options.id);

      if (!invoiceId && !options.yes && process.stdin.isTTY) {
        const resolved = await promptMissingArguments(
          [
            {
              name: "id",
              description: "Invoice ID to fund",
              required: true,
              validate: validatePositiveInteger,
            },
          ],
          { id: invoiceId },
        );
        invoiceId = resolved.id;
      }

      if (!invoiceId) {
        throw new Error("Missing required argument: --id. Provide it via option or pipe to stdin.");
      }
      const client = createClient(load());
      const result = await client.fundInvoice(
        parseInvoiceId(invoiceId),
        options.amount ? parseDisplayAmount(options.amount) : undefined,
      );

      const globalOpts = program.opts() as { json?: boolean };
      if (globalOpts.json) {
        stdout.write(JSON.stringify({ success: true, invoiceId: invoiceId, txHash: result.hash }, null, 2) + "\n");
      } else {
        ui.success(`Funded invoice ${invoiceId} in transaction ${result.hash}.`);
      }
    });

  program
    .command("pay")
    .description("Mark an invoice as paid using the configured signer account.")
    .option("--id <invoiceId>", "invoice ID")
    .option("--yes", "skip interactive prompts and use defaults")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln pay --id 42"),
        "",
        helpSection("Tips:"),
        helpExample("Only the payer address on the invoice can mark it paid."),
        helpExample("Run `iln status --id <id>` first to confirm the invoice is Funded."),
        "",
        helpSection("See also:"),
        helpExample("iln status --id <id>    Verify the invoice is now Paid"),
        helpExample("iln history --address <G>  View your payment history"),
      ].join("\n"),
    )
    .action(async (options: { id?: string; yes?: boolean }) => {
      let invoiceId = await resolveIdFromStdin(options.id);

      if (!invoiceId && !options.yes && process.stdin.isTTY) {
        const resolved = await promptMissingArguments(
          [
            {
              name: "id",
              description: "Invoice ID to mark as paid",
              required: true,
              validate: validatePositiveInteger,
            },
          ],
          { id: invoiceId },
        );
        invoiceId = resolved.id;
      }

      if (!invoiceId) {
        throw new Error("Missing required argument: --id. Provide it via option or pipe to stdin.");
      }
      const client = createClient(load());
      const result = await client.markPaid(parseInvoiceId(invoiceId));

      const globalOpts = program.opts() as { json?: boolean };
      if (globalOpts.json) {
        stdout.write(JSON.stringify({ success: true, invoiceId: invoiceId, txHash: result.hash }, null, 2) + "\n");
      } else {
        ui.success(`Marked invoice ${invoiceId} as paid in transaction ${result.hash}.`);
      }
    });

  program
    .command("status")
    .description("Show the current state of an invoice.")
    .option("--id <invoiceId>", "invoice ID")
    .option("--yes", "skip interactive prompts and use defaults")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln status --id 42"),
        helpExample("iln status --id 1    (invoice IDs start at 1)"),
        "",
        helpSection("See also:"),
        helpExample("iln list --address <G>  List all invoices for an address"),
        helpExample("iln history --address <G>  View full action history"),
      ].join("\n"),
    )
    .action(async (options: { id?: string; yes?: boolean }) => {
      let invoiceId = await resolveIdFromStdin(options.id);

      if (!invoiceId && !options.yes && process.stdin.isTTY) {
        const resolved = await promptMissingArguments(
          [
            {
              name: "id",
              description: "Invoice ID to check status",
              required: true,
              validate: validatePositiveInteger,
            },
          ],
          { id: invoiceId },
        );
        invoiceId = resolved.id;
      }

      if (!invoiceId) {
        throw new Error("Missing required argument: --id. Provide it via option or pipe to stdin.");
      }

      const client = createClient(load());
      const invoice = await client.getInvoice(parseInvoiceId(invoiceId));
      const opts = program.opts() as { json?: boolean };
      ui.info(opts.json ? formatInvoiceDetailsJson(invoice) : formatInvoiceDetails(invoice));
    });

  program
    .command("list")
    .description("List all invoices associated with a Stellar address.")
    .option("--address <address>", "freelancer, payer, or funder Stellar address")
    .option("--yes", "skip interactive prompts and use defaults")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln list --address GABC..."),
        helpExample("iln list --address GABC...   (returns invoices where address is freelancer, payer, or funder)"),
        "",
        helpSection("See also:"),
        helpExample("iln history --address <G>  Filter by action type or invoice ID"),
        helpExample("iln status --id <id>       Inspect a specific invoice"),
      ].join("\n"),
    )
    .action(async (options: { address?: string; yes?: boolean }) => {
      let address = options.address;

      if (!options.yes && process.stdin.isTTY) {
        const resolved = await promptMissingArguments(
          [
            {
              name: "address",
              description: "Stellar address to list invoices for",
              required: true,
              validate: validateStellarAddress,
            },
          ],
          { address },
        );
        address = resolved.address;
      }

      if (!address) {
        throw new Error("Missing required argument: --address");
      }

      assertStellarAddress(address, "address");
      const client = createClient(load());
      const invoices = await client.listInvoicesByAddress(address);
      const opts = program.opts() as { json?: boolean };
      ui.info(opts.json ? formatInvoiceListJson(invoices) : formatInvoiceList(invoices));
    });

  program
    .command("history")
    .description("Show past invoice submissions, fundings, and payments for a Stellar address.")
    .option("--address <address>", "Stellar address to query history for")
    .option("--id <invoiceId>", "filter to a specific invoice ID")
    .option(
      "--action <type>",
      "filter by action type: submit (freelancer), fund (funder), pay (payer)",
    )
    .option("--limit <n>", "maximum number of results to return")
    .option("--format <fmt>", "output format: table (default) or json", "table")
    .option("--yes", "skip interactive prompts and use defaults")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln history --address GABC..."),
        helpExample("iln history --address GABC... --action fund --limit 10 --format json"),
        "",
        helpSection("See also:"),
        helpExample("iln list --address <G>    Quick overview of all invoices"),
        helpExample("iln status --id <id>      Full details on a single invoice"),
      ].join("\n"),
    )
    .action(
      async (options: {
        address?: string;
        id?: string;
        action?: string;
        limit?: string;
        format: string;
        yes?: boolean;
      }) => {
        let address = options.address;

        if (!options.yes && process.stdin.isTTY) {
          const resolved = await promptMissingArguments(
            [
              {
                name: "address",
                description: "Stellar address to query history for",
                required: true,
                validate: validateStellarAddress,
              },
            ],
            { address },
          );
          address = resolved.address;
        }

        if (!address) {
          throw new Error("Missing required argument: --address");
        }

        assertStellarAddress(address, "address");

        if (options.format !== "table" && options.format !== "json") {
          throw new Error("--format must be table or json");
        }

        const ACTION_TO_ROLE: Record<string, "freelancer" | "funder" | "payer"> = {
          submit: "freelancer",
          fund: "funder",
          pay: "payer",
        };

        if (options.action && !ACTION_TO_ROLE[options.action]) {
          throw new Error(
            `--action must be one of: ${Object.keys(ACTION_TO_ROLE).join(", ")}`,
          );
        }

        const client = createClient(load());
        let invoices = await client.listInvoicesByAddress(address);

        if (options.id !== undefined) {
          const targetId = parseInvoiceId(options.id);
          invoices = invoices.filter((inv) => inv.id === targetId);
        }

        if (options.action) {
          const role = ACTION_TO_ROLE[options.action];
          invoices = invoices.filter((inv) => inv.role === role);
        }

        if (options.limit !== undefined) {
          const limit = parseInt(options.limit, 10);
          if (isNaN(limit) || limit <= 0) {
            throw new Error("--limit must be a positive integer");
          }
          invoices = invoices.slice(0, limit);
        }

        const globalOpts = program.opts() as { json?: boolean };
        const output =
          options.format === "json" || globalOpts.json
            ? formatHistoryJson(invoices)
            : formatHistoryTable(invoices);

        ui.info(output);
      },
    );

  // Compatibility check command
  const compatCommand = program.command("compat").description("SDK and contract compatibility utilities");

  compatCommand
    .command("check")
    .description("Check SDK compatibility with the deployed contract version.")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln compat check"),
        "",
        helpSection("Tips:"),
        helpExample("Run this after updating the SDK or redeploying the contract."),
        helpExample("A failed check means the SDK version does not match the on-chain contract."),
        "",
        helpSection("See also:"),
        helpExample("iln config   Show live protocol parameters from the contract"),
      ].join("\n"),
    )
    .action(async () => {
      const config = load();
      const client = createClient(config);

      const globalOpts = program.opts() as { json?: boolean };
      
      let checkError: Error | null = null;
      const result = await checkCompatibility(async (method: string) => {
        if (method === "get_version") {
          return client.getVersion();
        }
        throw new Error(`Unsupported compatibility check invoke method: ${method}`);
      });

      if (globalOpts.json) {
        stdout.write(JSON.stringify(result, null, 2) + "\n");
        if (!result.compatible) {
          throw new Error("Compatibility check failed.");
        }
        return;
      }

      ui.info("Checking contract compatibility...");
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
    .command("protocol-config")
    .description("Show live protocol configuration from the ILN contract.")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln config"),
        helpExample("iln config   (shows min amount, max rate, fee, reputation thresholds)"),
        "",
        helpSection("See also:"),
        helpExample("iln compat check   Verify SDK and contract versions are compatible"),
      ].join("\n"),
    )
    .action(async () => {
      const client = createClient(load());
      const config = await client.getProtocolConfig();
      const globalOpts = program.opts() as { json?: boolean };
      ui.info(globalOpts.json ? formatProtocolConfigJson(config) : formatProtocolConfig(config));
    });

  // Config file management
  const configCommand = program
    .command("config")
    .description("Manage the local ILN config file (.ilnrc.json).");

  configCommand
    .command("init")
    .description("Generate a starter .ilnrc.json config file in the current directory.")
    .option("--cwd <dir>", "directory to write the config file into (defaults to current directory)")
    .action((options: { cwd?: string }) => {
      const targetCwd = options.cwd ?? process.cwd();
      const created = initConfig(targetCwd);
      ui.success(`Created ${created}`);
      ui.info("Edit the file to set your contract IDs and keypair path, then run any iln command.");
    });

  configCommand
    .command("show")
    .description("Show the resolved configuration that would be used for the current directory.")
    .action(() => {
      const config = load();
      ui.info(describeConfig(config));
      ui.info(`  keypairPath  ${config.keypairPath}`);
      if (config.tokenId) {
        ui.info(`  tokenId      ${config.tokenId}`);
      }
    });

  const xdrCommand = program.command("xdr").description("Inspect Soroban XDR values");

  xdrCommand
    .command("decode")
    .description("Decode a base64 Soroban ScVal XDR value.")
    .argument("[base64]", "base64-encoded ScVal XDR")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln xdr decode AAAAAQAAAAA="),
        helpExample('iln xdr decode "$(stellar contract invoke ... 2>&1 | grep XDR)"'),
        "",
        helpSection("Tips:"),
        helpExample("Does not require a configured keypair or network connection."),
        helpExample("Useful for inspecting raw contract return values from Horizon or RPC responses."),
      ].join("\n"),
    )
    .action((base64?: string) => {
      if (!base64) {
        throw new Error("Missing base64 ScVal XDR. Usage: iln xdr decode <base64>");
      }

      stdout.write(formatDecodedScVal(decodeScValXdr(base64)));
    });

  // Dashboard command
  program
    .command("dashboard")
    .description("Launch the real-time dashboard for monitoring invoice activity.")
    .option("--refresh <ms>", "Refresh interval in milliseconds", "5000")
    .option("--export <file>", "Export dashboard data to JSON file")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln dashboard"),
        helpExample("iln dashboard --refresh 10000   (refresh every 10 seconds)"),
        helpExample("iln dashboard --export snapshot.json   (export data and exit)"),
        "",
        helpSection("Tips:"),
        helpExample("Press q or Ctrl-C to exit the dashboard."),
        helpExample("Use --export to capture a point-in-time snapshot for reporting."),
      ].join("\n"),
    )
    .action(async (options: { refresh: string; export?: string }) => {
      const config = load();
      const client = createClient(config);
      const { runDashboard } = await import("./dashboard");

      if (options.export) {
        const { Dashboard } = await import("./dashboard");
        const dashboard = new Dashboard(client, config, {
          refreshIntervalMs: parseInt(options.refresh, 10),
        });
        // Quick refresh and export
        await dashboard["refresh"]();
        const data = dashboard.exportData();
        const fs = await import("fs");
        fs.writeFileSync(options.export, JSON.stringify(data, null, 2));
        ui.success(`Dashboard data exported to ${options.export}`);
      } else {
        await runDashboard(client, config, {
          refreshIntervalMs: parseInt(options.refresh, 10),
        });
      }
    });

  // Generate command — template system for boilerplate code
  const collectVars = (val: string, prev: string[]): string[] => [...prev, val];

  program
    .command("generate")
    .description("Generate boilerplate code from a built-in or custom template.")
    .argument("[template]", "template name (omit or use --list to see available templates)")
    .option("--list", "list available templates and exit")
    .option("--preview", "print generated output without writing to disk")
    .option("--out <dir>", "output directory (default: current directory)", ".")
    .option("--var <key=value>", "set a template variable, repeatable (e.g. --var contractId=C…)", collectVars, [] as string[])
    .action(
      async (
        template: string | undefined,
        options: { list?: boolean; preview?: boolean; out: string; var: string[] },
      ) => {
        const { generate, listTemplates } = await import("./generate");

        if (options.list || !template) {
          const templates = listTemplates();
          ui.info("Available templates:\n");
          for (const t of templates) {
            ui.info(`  ${t.name.padEnd(24)} ${t.description}`);
          }
          if (!template && !options.list) {
            ui.info('\nUsage: iln generate <template> [--var key=value] [--preview] [--out <dir>]');
          }
          return;
        }

        const vars: Record<string, string> = {};
        for (const assignment of options.var) {
          const eq = assignment.indexOf("=");
          if (eq !== -1) vars[assignment.slice(0, eq)] = assignment.slice(eq + 1);
        }

        const result = generate({
          template,
          vars,
          outDir: options.out,
          preview: options.preview,
        });

        if (options.preview) {
          ui.info(`--- Preview: ${result.outputFile} ---\n`);
          stdout.write(result.content);
        } else {
          ui.success(`Generated ${result.outputFile}`);
        }
      },
    );

  // Development commands
  const devCommand = program.command("dev").description("Development utilities");

  devCommand
    .command("start")
    .description("Start a local Stellar node, deploy contracts, fund accounts, and write .env.local.")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln dev start"),
        "",
        helpSection("Tips:"),
        helpExample("Requires Docker. Pulls stellar/quickstart:testing on first run."),
        helpExample("Writes .env.local with contract IDs and funded keypairs."),
        "",
        helpSection("See also:"),
        helpExample("iln dev seed   Create testnet accounts after starting the environment"),
        helpExample("iln dev stop   Stop the local node when you are done"),
      ].join("\n"),
    )
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
    .option("--scenario <type>", "seeding scenario: new-user, active-lp, disputed")
    .option("--count <n>", "number of records to seed per scenario", "1")
    .option("--token <symbol>", "specific token to use: USDC or EURC")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln dev seed"),
        helpExample("iln dev seed --scenario active-lp --count 3 --token USDC"),
        "",
        helpSection("Tips:"),
        helpExample("Saves keypairs to .env.testnet.accounts for use in other commands."),
        helpExample("Use --scenario new-user to get a blank freelancer + payer pair."),
        helpExample("Use --scenario active-lp to pre-fund invoices for LP testing."),
        "",
        helpSection("See also:"),
        helpExample("iln dev start   Start the local environment before seeding"),
      ].join("\n"),
    )
    .action(async (options: { scenario?: string; count?: string; token?: string }) => {
      const config = load();
      const seeder = new TestnetAccountSeeder({ config, ui });
      const count = parseInt(options.count ?? "1", 10);
      if (isNaN(count) || count <= 0) {
        throw new Error("--count must be a positive integer");
      }
      await seeder.seed({ scenario: options.scenario, count, token: options.token });
    });

  // Version management commands
  program
    .command("update")
    .description("Check for and install CLI updates.")
    .argument("[version]", "target version to install")
    .action(async (version?: string) => {
      await versionManager.performUpdate(version);
    });

  program
    .command("changelog")
    .description("Show the changelog for the installed or specified version.")
    .argument("[version]", "version to show changelog for")
    .action(async (version?: string) => {
      await versionManager.showChangelog(version);
  // Wallet management commands
  const walletCommand = program
    .command("wallet")
    .description("Manage Stellar keypairs for use with ILN.");

  walletCommand
    .command("create")
    .description("Generate a new Stellar keypair and store it encrypted.")
    .requiredOption("--name <name>", "wallet name identifier")
    .requiredOption("--password <password>", "encryption password for the wallet")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample('iln wallet create --name my-wallet --password "my-secret"'),
        "",
        helpSection("Tips:"),
        helpExample("Wallets are stored encrypted at ~/.iln/wallets/."),
        helpExample("Use a strong password to protect your keypair."),
        "",
        helpSection("See also:"),
        helpExample("iln wallet list       List all stored wallets"),
        helpExample("iln wallet import     Import an existing secret key"),
      ].join("\n"),
    )
    .action((options: { name: string; password: string }) => {
      const wallet = createWallet(options.name, options.password);
      ui.success(`Created wallet '${wallet.name}'`);
      ui.info(`Public key: ${wallet.publicKey}`);
      ui.info(`Created at: ${wallet.createdAt}`);
    });

  walletCommand
    .command("import")
    .description("Import an existing Stellar secret key into an encrypted wallet.")
    .requiredOption("--name <name>", "wallet name identifier")
    .requiredOption("--secret <secret>", "Stellar secret key (starts with S)")
    .requiredOption("--password <password>", "encryption password for the wallet")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample('iln wallet import --name my-wallet --secret SABC... --password "my-secret"'),
        "",
        helpSection("Tips:"),
        helpExample("The secret key is validated before import."),
        helpExample("Use a strong password to protect your keypair."),
        "",
        helpSection("See also:"),
        helpExample("iln wallet list       List all stored wallets"),
        helpExample("iln wallet create     Generate a new keypair"),
      ].join("\n"),
    )
    .action((options: { name: string; secret: string; password: string }) => {
      const wallet = importWallet(options.name, options.secret, options.password);
      ui.success(`Imported wallet '${wallet.name}'`);
      ui.info(`Public key: ${wallet.publicKey}`);
      ui.info(`Created at: ${wallet.createdAt}`);
    });

  walletCommand
    .command("list")
    .description("List all stored wallets.")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln wallet list"),
        "",
        helpSection("See also:"),
        helpExample("iln wallet create     Generate a new keypair"),
        helpExample("iln wallet import     Import an existing secret key"),
      ].join("\n"),
    )
    .action(() => {
      const wallets = listWallets();
      if (wallets.length === 0) {
        ui.info("No wallets found. Use 'iln wallet create' or 'iln wallet import' to add one.");
        return;
      }

      ui.info("Stored wallets:\n");
      for (const wallet of wallets) {
        ui.info(`  ${wallet.name}`);
        ui.info(`    Public key: ${wallet.publicKey}`);
        ui.info(`    Created: ${wallet.createdAt}`);
        ui.info("");
      }
    });

  walletCommand
    .command("fund")
    .description("Fund a wallet from Stellar Friendbot (testnet only).")
    .requiredOption("--name <name>", "wallet name to fund")
    .requiredOption("--password <password>", "encryption password for the wallet")
    .option("--friendbot <url>", "Friendbot URL", "https://friendbot.stellar.org")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample('iln wallet fund --name my-wallet --password "my-secret"'),
        "",
        helpSection("Tips:"),
        helpExample("Only works on testnet. Requires the wallet to exist."),
        helpExample("Funds are sent to the wallet's public key."),
        "",
        helpSection("See also:"),
        helpExample("iln wallet list       List all stored wallets"),
      ].join("\n"),
    )
    .action(async (options: { name: string; password: string; friendbot?: string }) => {
      const wallets = listWallets();
      const wallet = wallets.find((w) => w.name === options.name);
      if (!wallet) {
        throw new Error(`Wallet '${options.name}' not found.`);
      }

      ui.info(`Funding wallet '${options.name}' (${wallet.publicKey})...`);
      await fundWalletFromFriendbot(wallet.publicKey, options.friendbot);
      ui.success(`Successfully funded wallet '${options.name}'`);
    });

  walletCommand
    .command("delete")
    .description("Delete a stored wallet.")
    .requiredOption("--name <name>", "wallet name to delete")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln wallet delete --name my-wallet"),
        "",
        helpSection("Tips:"),
        helpExample("This action cannot be undone. Make sure you have backed up your secret key."),
        "",
        helpSection("See also:"),
        helpExample("iln wallet list       List all stored wallets"),
      ].join("\n"),
    )
    .action((options: { name: string }) => {
      deleteWallet(options.name);
      ui.success(`Deleted wallet '${options.name}'`);
    });

  // Interactive mode
  program
    .command("interactive")
    .description("Start an interactive guided session for invoice operations.")
    .action(async () => {
      const config = load();
      const client = createClient(config);
      await runInteractive({ client, config, ui });
    });

  // Tutorial mode
  program
    .command("tutorial")
    .description("Step-by-step guided tutorial for submitting your first invoice.")
    .addHelpText(
      "after",
      [
        "",
        helpSection("About:"),
        helpExample("Walks you through each field with explanations at every step."),
        helpExample("Progress is saved so you can resume if interrupted."),
        helpExample("Type 'skip' at any prompt to exit and save your progress."),
        "",
        helpSection("Examples:"),
        helpExample("iln tutorial              (start or resume the tutorial)"),
        "",
        helpSection("See also:"),
        helpExample("iln interactive           Full interactive mode without explanations"),
        helpExample("iln submit --help         Reference for the submit command"),
      ].join("\n"),
    )
    .action(async () => {
      const config = load();
      const client = createClient(config);
      await runTutorial({ client, config, ui });
    });

  program
    .command("man")
    .description("Print a roff man page for iln or a subcommand.")
    .argument("[command]", "subcommand to document, e.g. submit, fund, pay")
    .addHelpText(
      "after",
      [
        "",
        helpSection("Examples:"),
        helpExample("iln man                  (top-level man page)"),
        helpExample("iln man submit           (man page for the submit command)"),
        helpExample("iln man | man -l -       (view in terminal man pager)"),
        helpExample("iln man submit > iln-submit.1  (save to file)"),
      ].join("\n"),
    )
    .action((commandName?: string) => {
      stdout.write(generateManPage(program, commandName));
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error: any) {
    const isJson = program.opts().json;
    if (isJson) {
      stdout.write(JSON.stringify({ success: false, error: formatUnknownError(error) }, null, 2) + "\n");
    } else {
      ui.error(formatUnknownError(error));
    }
    return 1;
  }
}

export async function main(): Promise<void> {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    const onData = (chunk: string) => {
      data += chunk;
    };
    const onEnd = () => {
      cleanup();
      resolve(data.trim());
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      clearTimeout(timeoutId);
    };
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(data.trim());
    }, 1000);

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}

async function resolveIdFromStdin(optionId?: string): Promise<string | undefined> {
  if (optionId && optionId !== "-") {
    return optionId;
  }
  const stdinVal = await readStdin();
  if (!stdinVal) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(stdinVal);
    const idVal = parsed.invoiceId ?? parsed.id;
    if (idVal !== undefined) {
      return String(idVal);
    }
  } catch {
    // Treat as raw text ID
  }
  return stdinVal;
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
