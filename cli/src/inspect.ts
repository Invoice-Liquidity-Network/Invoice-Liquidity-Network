import { Command } from "commander";
import type { ILNClient } from "../../sdk/src/client";
import type { ResolvedConfig } from "./config";
import type { Ui } from "./format"; // use any if not exported


export function registerInspectCommand(
  program: Command,
  createClient: (config: ResolvedConfig) => ILNClient,
  loadConfig: (options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => ResolvedConfig,
  ui: Ui,
) {
  const inspect = program.command("inspect").description("Inspect contract state");

  inspect
    .command("invoice <id>")
    .description("Print full invoice struct as formatted JSON")
    .option("--format <type>", "output format", "json")
    .action(async (id: string, options: { format: string }) => {
      const config = loadConfig();
      const client = createClient(config);
      const invoice = await client.getInvoice(BigInt(id));
      outputResult(invoice, options.format);
    });

  inspect
    .command("reputation <address>")
    .description("Print reputation score for an address")
    .option("--format <type>", "output format", "json")
    .action(async (address: string, options: { format: string }) => {
      const config = loadConfig();
      const client = createClient(config);
      const score = await client.getReputation(address);
      outputResult({ address, score }, options.format);
    });

  inspect
    .command("stats")
    .description("Print contract-wide statistics")
    .option("--format <type>", "output format", "json")
    .action(async (options: { format: string }) => {
      const config = loadConfig();
      const client = createClient(config);
      const stats = await client.getStats();
      outputResult(stats, options.format);
    });

  inspect
    .command("proposal <id>")
    .description("Print governance proposal")
    .option("--format <type>", "output format", "json")
    .action(async (id: string, options: { format: string }) => {
      const config = loadConfig();
      const client = createClient(config);
      const proposal = await client.getProposal(BigInt(id));
      outputResult(proposal, options.format);
    });

  inspect
    .command("storage <key>")
    .description("Raw storage key lookup for advanced debugging")
    .option("--format <type>", "output format", "json")
    .action(async (key: string, options: { format: string }) => {
      const config = loadConfig();
      const client = createClient(config);
      const value = await client.getStorage(key);
      outputResult({ key, value }, options.format);
    });

  function outputResult(data: unknown, format: string) {
    if (format === "json") {
      ui.info(JSON.stringify(data, null, 2));
    } else {
      // Placeholder for future table format
      ui.info(String(data));
    }
  }
}
