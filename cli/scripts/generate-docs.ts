import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import { runCli } from '../src/cli.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputFile = path.resolve(scriptDir, '../../packages/docs/content/cli-reference.mdx');

async function main() {
  const program = (await runCli([], { __returnProgramForDocs: true })) as unknown as Command;

  let md = `---
title: CLI Reference
description: Auto-generated CLI command reference for the Invoice Liquidity Network
---

# CLI Command Reference

This document is auto-generated from the CLI source code. Do not edit manually.

## \`${program.name()}\`

${program.description()}

### Global Options

| Option | Description | Default |
|--------|-------------|---------|
`;

  const escapeMarkdownTableCell = (value: string) =>
    value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

  program.options.forEach((opt: Option) => {
    const flags = escapeMarkdownTableCell(opt.flags);
    const desc = escapeMarkdownTableCell(opt.description);
    const def = opt.defaultValue ? `\`${opt.defaultValue}\`` : '';
    md += `| \`${flags}\` | ${desc} | ${def} |\n`;
  });
  md += `\n`;

  function renderCommand(cmd: Command, parentNames: string[]) {
    if ((cmd as any)._hidden) return;

    const fullName = [...parentNames, cmd.name()].join(' ');
    md += `## \`${fullName}\`\n\n`;
    md += `${cmd.description()}\n\n`;

    // Usage
    const args = (cmd as any)._args
      ? (cmd as any)._args
          .map((a: any) => `${a.required ? '<' : '['}${a.name()}${a.required ? '>' : ']'}`)
          .join(' ')
      : '';
    md += `### Usage\n\n\`\`\`bash\n${fullName}${args ? ' ' + args : ''} [options]\n\`\`\`\n\n`;

    // Options
    if (cmd.options.length > 0) {
      md += `### Options\n\n`;
      md += `| Option | Description | Default |\n`;
      md += `|--------|-------------|---------|\n`;
      cmd.options.forEach((opt: Option) => {
        const flags = opt.flags.replace(/\|/g, '\\|');
        const desc = opt.description.replace(/\|/g, '\\|');
        const def = opt.defaultValue ? `\`${opt.defaultValue}\`` : '';
        md += `| \`${flags}\` | ${desc} | ${def} |\n`;
      });
      md += `\n`;
    }

    const helper = program.createHelp();
    const afterTexts = cmd.helpInformation ? cmd.helpInformation() : '';
    // Wait, let's just get the "after" text if possible.
    // In commander, getHelpText doesn't exist, we can access _helpText?
    // Actually, commander has `cmd.helpInformation()` which returns the whole block.
    // If we want just the `addHelpText` content:
    const customHelp = (cmd as any)._helpText || [];
    const afterHelp = customHelp
      .filter((h: any) => h.position === 'after')
      .map((h: any) => (typeof h.text === 'function' ? h.text() : h.text))
      .join('\n');

    if (afterHelp) {
      // Strip ANSI codes if picocolors added any
      const stripped = afterHelp.replace(/\x1b\[[0-9;]*m/g, '');
      md += `${stripped.trim()}\n\n`;
    }

    if (cmd.commands && cmd.commands.length > 0) {
      cmd.commands.forEach((sub) => renderCommand(sub, [...parentNames, cmd.name()]));
    }
  }

  program.commands.forEach((cmd) => renderCommand(cmd, [program.name()]));

  fs.writeFileSync(outputFile, md, 'utf8');
  console.log(`Generated CLI docs to ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
