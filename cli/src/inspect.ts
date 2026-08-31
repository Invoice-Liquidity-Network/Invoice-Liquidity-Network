import { Command } from 'commander';
import type { ILNClient } from './client';
import type { ResolvedConfig } from './types';
import type { Ui } from './format'; // use any if not exported
import { formatJsonSuccess } from './format';

export function registerInspectCommand(
  program: Command,
  createClient: (config: ResolvedConfig) => ILNClient,
  loadConfig: (options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => ResolvedConfig,
  ui: Ui
) {
  const inspect = program.command('inspect').description('Inspect contract state');

  inspect
    .command('invoice <id>')
    .description('Print full invoice struct as formatted JSON')
    .option('--format <type>', 'output format', 'json')
    .action(async (id: string, options: { format: string }) => {
      const config = loadConfig();
      const client = createClient(config);
      const invoice = await client.getInvoice(BigInt(id));
      outputResult(invoice, options.format);
    });

  function outputResult(data: unknown, format: string) {
    const globalOpts = program.opts() as { json?: boolean };
    if (format === 'json' || globalOpts.json) {
      ui.info(formatJsonSuccess(data));
    } else {
      // Placeholder for future table format
      ui.info(String(data));
    }
  }
}
