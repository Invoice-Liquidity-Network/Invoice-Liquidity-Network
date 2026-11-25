import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { generateBashCompletion, generateZshCompletion, registerCompletionCommand } from '../src/completion';
import { registerEnvCommands } from '../src/env';
import { registerInspectCommand } from '../src/inspect';
import { runCli } from '../src/cli';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ResolvedConfig } from '../src/types';

/**
 * Builds the full set of top-level command names the CLI actually
 * registers (cli.ts plus the commands env.ts, inspect.ts, and
 * completion.ts bolt on), so tests can check the completion scripts
 * for drift without hand-maintaining a second copy of this list.
 */
async function actualTopLevelCommands(): Promise<string[]> {
  const program = (await runCli([], {
    __returnProgramForDocs: true,
    loadConfig: () => ({}) as ResolvedConfig,
    createClient: () => ({}) as any,
  })) as Command;

  const extra = new Command();
  registerCompletionCommand(extra);
  registerEnvCommands(extra);
  registerInspectCommand(extra, () => ({}) as any, () => ({}) as ResolvedConfig, {
    info: () => {},
    error: () => {},
    success: () => {},
  } as any);

  return [...program.commands, ...extra.commands].map((c) => c.name());
}

describe('Shell Completion', () => {
  describe('generateBashCompletion', () => {
    it('should return a valid bash script', () => {
      const script = generateBashCompletion();

      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('_iln_completions');
      expect(script).toContain('complete -F _iln_completions iln');
    });

    it('should include all commands', () => {
      const script = generateBashCompletion();

      for (const name of [
        'submit',
        'fund',
        'pay',
        'status',
        'list',
        'history',
        'watch',
        'export',
        'stats',
        'reputation',
        'network',
        'compat',
        'protocol-config',
        'config',
        'xdr',
        'dashboard',
        'generate',
        'dev',
        'update',
        'changelog',
        'wallet',
        'interactive',
        'tutorial',
        'man',
        'alias',
        'env',
        'inspect',
        'completion',
      ]) {
        expect(script).toContain(name);
      }
    });

    it('should include submit options, including --yes', () => {
      const script = generateBashCompletion();

      expect(script).toContain('--payer');
      expect(script).toContain('--amount');
      expect(script).toContain('--due');
      expect(script).toContain('--rate');
      expect(script).toContain('--token');
      expect(script).toContain('--yes');
    });

    it('should include history options', () => {
      const script = generateBashCompletion();

      expect(script).toContain('--address');
      expect(script).toContain('--action');
      expect(script).toContain('--limit');
      expect(script).toContain('--format');
    });

    it('should include dev subcommands', () => {
      const script = generateBashCompletion();

      expect(script).toContain('start');
      expect(script).toContain('stop');
      expect(script).toContain('reset');
      expect(script).toContain('seed');
    });

    it('should distinguish config (local config file) from protocol-config (on-chain)', () => {
      const script = generateBashCompletion();

      expect(script).toContain('init show --help');
      expect(script).toContain('protocol-config)');
    });

    it('should include env and inspect subcommands', () => {
      const script = generateBashCompletion();

      expect(script).toContain('list use create delete show --help');
      expect(script).toContain('invoice --help');
    });
  });

  describe('generateZshCompletion', () => {
    it('should return a valid zsh script', () => {
      const script = generateZshCompletion();

      expect(script).toContain('#compdef iln');
      expect(script).toContain('_iln()');
    });

    it('should include all commands with descriptions', () => {
      const script = generateZshCompletion();

      expect(script).toContain('submit:Submit a new invoice');
      expect(script).toContain('fund:Fund an invoice');
      expect(script).toContain('pay:Mark an invoice as paid');
      expect(script).toContain('status:Show invoice status');
      expect(script).toContain('list:List invoices by address');
      expect(script).toContain('history:Show invoice history');
      expect(script).toContain('watch:Watch an invoice for real-time status updates');
      expect(script).toContain('export:Export invoices to CSV');
      expect(script).toContain('stats:Show protocol-wide analytics');
      expect(script).toContain('reputation:Query on-chain reputation scores');
      expect(script).toContain('network:Manage the active Stellar network');
      expect(script).toContain('compat:SDK and contract compatibility utilities');
      expect(script).toContain('protocol-config:Show live protocol configuration');
      expect(script).toContain('config:Manage the local ILN config file');
      expect(script).toContain('xdr:Inspect Soroban XDR values');
      expect(script).toContain('dashboard:Launch real-time dashboard');
      expect(script).toContain('dev:Development utilities');
      expect(script).toContain('wallet:Manage Stellar keypairs for use with ILN');
      expect(script).toContain('env:Manage ILN environments');
      expect(script).toContain('inspect:Inspect contract state');
    });

    it('should include dev subcommands', () => {
      const script = generateZshCompletion();

      expect(script).toContain('start:Start local development environment');
      expect(script).toContain('stop:Stop local development environment');
      expect(script).toContain('reset:Reset local development environment');
      expect(script).toContain('status:Show local environment status');
      expect(script).toContain('seed:Create and fund testnet accounts');
    });

    it('should include history options with action choices', () => {
      const script = generateZshCompletion();

      expect(script).toContain('--action');
      expect(script).toContain('submit fund pay');
      expect(script).toContain('--format');
      expect(script).toContain('table json');
    });

    it('should include seed options with scenario choices', () => {
      const script = generateZshCompletion();

      expect(script).toContain('--scenario');
      expect(script).toContain('new-user active-lp disputed');
      expect(script).toContain('--token');
      expect(script).toContain('USDC EURC');
    });

    it('should describe config subcommands (init/show), not protocol fields', () => {
      const script = generateZshCompletion();

      expect(script).toContain("init:Generate a starter .ilnrc.json config file");
      expect(script).toContain('show:Show the resolved configuration');
    });
  });

  describe('Syntax Validation', () => {
    it('bash completion script has valid syntax', () => {
      const script = generateBashCompletion();
      const tmpFile = join(tmpdir(), `iln-completion-bash-${Date.now()}.sh`);

      try {
        writeFileSync(tmpFile, script);

        // Validate bash syntax (bash -n checks syntax without executing)
        // If syntax is invalid, execSync will throw
        const result = execSync(`bash -n "${tmpFile}" 2>&1`, {
          encoding: 'utf-8',
        });

        // No output from bash -n means syntax is valid
        expect(result.trim()).toBe('');
      } finally {
        try {
          unlinkSync(tmpFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('zsh completion script has valid syntax', () => {
      const script = generateZshCompletion();
      const tmpFile = join(tmpdir(), `iln-completion-zsh-${Date.now()}.zsh`);

      try {
        writeFileSync(tmpFile, script);

        // Try to validate zsh syntax (zsh may not be available on CI)
        try {
          const result = execSync(`zsh -n "${tmpFile}" 2>&1`, {
            encoding: 'utf-8',
          });

          // No output from zsh -n means syntax is valid
          expect(result.trim()).toBe('');
        } catch (error: any) {
          // If zsh is not installed, skip this check but log a warning
          if (error.message.includes('not found') || error.status === 127) {
            console.warn('zsh not available for syntax validation');
          } else {
            // Re-throw if it's a syntax error
            throw error;
          }
        }
      } finally {
        try {
          unlinkSync(tmpFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Supported Shells', () => {
    it('completion command documents supported shells', () => {
      // This test verifies that the completion functionality supports
      // bash and zsh. If more shells are added, update this test and
      // the completion.ts file
      const bash = generateBashCompletion();
      const zsh = generateZshCompletion();

      expect(bash).toBeDefined();
      expect(zsh).toBeDefined();
      expect(bash.length).toBeGreaterThan(0);
      expect(zsh.length).toBeGreaterThan(0);
    });
  });

  describe('Drift guard against the live CLI', () => {
    it('lists every top-level command the CLI actually registers', async () => {
      const names = await actualTopLevelCommands();
      const bash = generateBashCompletion();
      const zsh = generateZshCompletion();

      const missingFromBash = names.filter((name) => !bash.includes(name));
      const missingFromZsh = names.filter((name) => !zsh.includes(name));

      expect(missingFromBash, `commands missing from bash completion: ${missingFromBash.join(', ')}`).toEqual([]);
      expect(missingFromZsh, `commands missing from zsh completion: ${missingFromZsh.join(', ')}`).toEqual([]);
    });
  });
});
