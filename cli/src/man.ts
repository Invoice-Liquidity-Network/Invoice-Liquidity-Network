import type { Command, Option, Argument } from 'commander';

const TODAY = new Date().toISOString().slice(0, 7); // YYYY-MM

// Commander tracks a command's hidden state on an internal `_hidden` field
// (set via `.hideHelp()` or `{ hidden: true }`); there's no public getter.
function isHiddenCommand(command: Command): boolean {
  return Boolean((command as unknown as { _hidden?: boolean })._hidden);
}

function roffEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\./g, '\\&.').replace(/-/g, '\\-');
}

function formatOptions(options: readonly Option[]): string {
  if (options.length === 0) return '';
  const lines: string[] = ['.SH OPTIONS'];
  for (const opt of options) {
    const flags = roffEscape(opt.flags);
    lines.push(`.TP`);
    lines.push(`.B ${flags}`);
    if (opt.description) lines.push(roffEscape(opt.description));
  }
  return lines.join('\n');
}

function formatArguments(args: readonly Argument[]): string {
  if (args.length === 0) return '';
  const lines: string[] = ['.SH ARGUMENTS'];
  for (const arg of args) {
    const name = roffEscape(arg.name());
    lines.push('.TP');
    lines.push(`.B ${name}`);
    if (arg.description) lines.push(roffEscape(arg.description));
  }
  return lines.join('\n');
}

function synopsisLine(cmd: Command): string {
  const parts: string[] = [cmd.name()];
  if (cmd.options.length > 0) parts.push('[options]');
  for (const arg of cmd.registeredArguments) {
    const name = arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
    parts.push(name);
  }
  return parts.join(' ');
}

function commandSection(sub: Command): string {
  const lines: string[] = [];
  lines.push(`.SS ${roffEscape(sub.name())}`);
  if (sub.description()) lines.push(roffEscape(sub.description()));
  lines.push(`.PP`);
  lines.push(`.B Synopsis:`);
  lines.push(`.br`);
  lines.push(roffEscape(synopsisLine(sub)));

  const visibleOpts = sub.options.filter((o) => !o.hidden);
  if (visibleOpts.length > 0) {
    lines.push('.PP');
    lines.push('.B Options:');
    for (const opt of visibleOpts) {
      lines.push('.TP');
      lines.push(`.B ${roffEscape(opt.flags)}`);
      if (opt.description) lines.push(roffEscape(opt.description));
    }
  }

  return lines.join('\n');
}

function generateTopLevelManPage(program: Command): string {
  const name = program.name();
  const desc = program.description() || `${name} command line tool`;

  const sections: string[] = [
    `.TH ${name.toUpperCase()} 1 "${TODAY}" "${name}" "Invoice Liquidity Network"`,
    `.SH NAME`,
    `${roffEscape(name)} \\- ${roffEscape(desc)}`,
    `.SH SYNOPSIS`,
    `.B ${name}`,
    `.RI [ options ]`,
    `.RI < command >`,
    `.RI [ command\\-options ]`,
    `.SH DESCRIPTION`,
    roffEscape(desc),
    `.PP`,
    `For per\\-command documentation run:`,
    `.PP`,
    `.RS`,
    `.B iln man <command>`,
    `.RE`,
  ];

  // Commands section
  const cmds = program.commands.filter((c) => !isHiddenCommand(c));
  if (cmds.length > 0) {
    sections.push('.SH COMMANDS');
    for (const cmd of cmds) {
      sections.push('.TP');
      sections.push(`.B ${roffEscape(cmd.name())}`);
      sections.push(roffEscape(cmd.description() || ''));
    }
  }

  // Root options
  const rootOpts = program.options.filter((o) => !o.hidden);
  if (rootOpts.length > 0) {
    sections.push(formatOptions(rootOpts));
  }

  sections.push('.SH EXAMPLES');
  sections.push('.TP');
  sections.push('.B Submit an invoice:');
  sections.push('.br');
  sections.push(roffEscape('iln submit --payer G... --amount 100 --due 2026-03-31 --rate 300'));
  sections.push('.TP');
  sections.push('.B Fund an invoice:');
  sections.push('.br');
  sections.push(roffEscape('iln fund --id 42'));
  sections.push('.TP');
  sections.push('.B Check invoice status:');
  sections.push('.br');
  sections.push(roffEscape('iln status --id 42'));
  sections.push('.TP');
  sections.push('.B Start a local dev environment:');
  sections.push('.br');
  sections.push(roffEscape('iln dev start'));

  sections.push('.SH CONFIGURATION');
  sections.push(
    roffEscape(
      'Configuration is loaded from .iln.json in the working directory, or from environment variables prefixed with ILN_ (e.g. ILN_NETWORK, ILN_CONTRACT_ID, ILN_KEYPAIR_PATH).'
    )
  );

  sections.push('.SH SEE ALSO');
  sections.push(
    roffEscape(
      'iln-submit(1), iln-fund(1), iln-pay(1), iln-status(1), iln-list(1), iln-history(1), iln-dashboard(1), iln-dev(1)'
    )
  );

  return sections.join('\n') + '\n';
}

function generateSubcommandManPage(program: Command, commandName: string): string {
  const sub = program.commands.find((c) => c.name().toLowerCase() === commandName.toLowerCase());

  if (!sub) {
    return `Error: unknown command '${commandName}'. Run 'iln man' for the top-level man page.\n`;
  }

  const pageName = `ILN-${commandName.toUpperCase()}`;
  const desc = sub.description() || `${commandName} subcommand`;

  const sections: string[] = [
    `.TH ${pageName} 1 "${TODAY}" "iln" "Invoice Liquidity Network"`,
    `.SH NAME`,
    `iln\\-${roffEscape(commandName)} \\- ${roffEscape(desc)}`,
    `.SH SYNOPSIS`,
    `.B iln ${roffEscape(synopsisLine(sub))}`,
    `.SH DESCRIPTION`,
    roffEscape(desc),
  ];

  // Nested subcommands
  const subCmds = sub.commands.filter((c) => !isHiddenCommand(c));
  if (subCmds.length > 0) {
    sections.push('.SH COMMANDS');
    for (const nested of subCmds) {
      sections.push(commandSection(nested));
    }
  }

  const visibleOpts = sub.options.filter((o) => !o.hidden);
  if (visibleOpts.length > 0) {
    sections.push(formatOptions(visibleOpts));
  }

  const visibleArgs = sub.registeredArguments;
  if (visibleArgs.length > 0) {
    sections.push(formatArguments(visibleArgs));
  }

  return sections.join('\n') + '\n';
}

export function generateManPage(program: Command, commandName?: string): string {
  if (!commandName) {
    return generateTopLevelManPage(program);
  }
  return generateSubcommandManPage(program, commandName);
}
