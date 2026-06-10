import { Command } from "commander";
import { registerCommands } from "./commands";

export async function run(argv: string[] = process.argv) {
  const program = new Command();
  
  program
    .name("iln")
    .description("Invoice Liquidity Network CLI")
    .version("0.1.0")
    .option("--json", "output machine-readable JSON");

  registerCommands(program);

  await program.parseAsync(argv);
}
