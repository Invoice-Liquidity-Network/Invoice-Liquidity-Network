import { Networks } from '@stellar/stellar-sdk';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type { ResolvedConfig, SupportedNetwork } from './types';

// ─── Network defaults ─────────────────────────────────────────────────────────

const DEFAULTS: Record<SupportedNetwork, { networkPassphrase: string; rpcUrl: string }> = {
  mainnet: {
    networkPassphrase: Networks.PUBLIC,
    rpcUrl: 'https://mainnet.sorobanrpc.com',
  },
  standalone: {
    networkPassphrase: Networks.STANDALONE,
    rpcUrl: 'http://localhost:8000/soroban/rpc',
  },
  testnet: {
    networkPassphrase: Networks.TESTNET,
    rpcUrl: 'https://soroban-testnet.stellar.org',
  },
};

// ─── Config file search order ─────────────────────────────────────────────────
//
// Precedence (first match wins):
//   1. .iln.config.ts   (TypeScript, requires ts-node/jiti)
//   2. .iln.json        (JSON, legacy)
//   3. .ilnrc.json      (JSON, XDG-style)
//   4. .ilnrc.yaml      (YAML, requires js-yaml or yaml package)
//   5. .ilnrc.yml       (YAML, alternate extension)

const CONFIG_FILE_CANDIDATES = [
  '.iln.config.ts',
  '.iln.json',
  '.ilnrc.json',
  '.ilnrc.yaml',
  '.ilnrc.yml',
] as const;

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

export const ConfigSchema = z.object({
  /** Path to JSON schema */
  $schema: z.string().optional(),
  /** Config file version. Defaults to 2. */
  version: z.number().optional().default(2),
  /** Target Stellar network. Defaults to "testnet". */
  network: z.enum(['testnet', 'mainnet', 'standalone']).optional().default('testnet'),
  horizonUrl: z.string().url().optional(),
  rpcUrl: z.string().url().optional(),
  /** Contract IDs keyed by role, e.g. { invoice: "C…", token: "C…" }. */
  contractIds: z
    .object({
      invoice: z.string().optional(),
      token: z.string().optional(),
    })
    .catchall(z.string())
    .default({}),
  deployer: z
    .object({
      keypairPath: z.string().optional(),
    })
    .optional(),
  /** Pin the CLI to a specific version. Throws if current version doesn't match. */
  requiredVersion: z.string().optional(),
  /** Whether to automatically check for updates on startup. Defaults to true. */
  autoUpdate: z.boolean().optional().default(true),
  /** Custom CLI aliases, e.g. { "sub": "submit" } */
  aliases: z.record(z.string()).optional().default({}),
});

export type ILNConfigFile = z.infer<typeof ConfigSchema>;

// ─── Migration ───────────────────────────────────────────────────────────────

/**
 * Migrate legacy configuration format (version 1) to the new nested format (version 2).
 * Writes the migrated configuration back to disk if it was loaded from a JSON file.
 */
export function migrateConfig(rawConfig: any, filePath: string | null): any {
  if (!rawConfig || typeof rawConfig !== 'object') return rawConfig;

  // Clone object to avoid mutating the original reference
  const migrated = JSON.parse(JSON.stringify(rawConfig));
  let changed = false;

  // Migrate legacy root-level contractId -> contractIds.invoice
  if (migrated.contractId) {
    migrated.contractIds = migrated.contractIds || {};
    if (!migrated.contractIds.invoice) {
      migrated.contractIds.invoice = migrated.contractId;
    }
    delete migrated.contractId;
    changed = true;
  }

  // Migrate legacy root-level keypairPath -> deployer.keypairPath
  if (migrated.keypairPath) {
    if (!migrated.deployer) {
      migrated.deployer = {};
    }
    if (!migrated.deployer.keypairPath) {
      migrated.deployer.keypairPath = migrated.keypairPath;
    }
    delete migrated.keypairPath;
    changed = true;
  }

  // Migrate legacy root-level tokenId -> contractIds.token
  if (migrated.tokenId) {
    migrated.contractIds = migrated.contractIds || {};
    if (!migrated.contractIds.token) {
      migrated.contractIds.token = migrated.tokenId;
    }
    delete migrated.tokenId;
    changed = true;
  }

  // Upgrade version to 2 if missing or older
  if (migrated.version === undefined || migrated.version < 2) {
    migrated.version = 2;
    changed = true;
  }

  // Write migrated config back to file in-place if it's a JSON file
  if (changed && filePath && existsSync(filePath)) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.json') {
        if (!migrated['$schema']) {
          migrated['$schema'] = './config.schema.json';
        }
        writeFileSync(filePath, JSON.stringify(migrated, null, 2) + '\n');
      }
    } catch (err: any) {
      // Ignore write errors to ensure robustness (e.g. read-only filesystems)
    }
  }

  return migrated;
}

// ─── Load options ─────────────────────────────────────────────────────────────

export interface LoadConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load and validate configuration.
 *
 * Resolution order:
 *   1. CLI flags (caller is responsible for passing env overrides)
 *   2. Environment variables (ILN_*)
 *   3. Config file (first matching candidate in CONFIG_FILE_CANDIDATES)
 *   4. Built-in network defaults
 */
export function loadConfig(options: LoadConfigOptions = {}): ResolvedConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  const { rawConfig: initialRawConfig, filePath } = readConfigFile(cwd);

  // Migrate old configuration structures dynamically
  const rawConfig = migrateConfig(initialRawConfig, filePath);

  // Validate shape
  const parsed = ConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    const hint = filePath ? ` (${path.basename(filePath)})` : '';
    const messages = parsed.error.issues
      .map((i) => `[Field: ${i.path.join('.') || '<root>'}] - ${i.message}`)
      .join('; ');
    throw new ConfigValidationError(`Config validation failed${hint}: ${messages}`);
  }

  const fileConfig = parsed.data;
  const network = resolveNetwork(fileConfig, env);
  const defaults = DEFAULTS[network];

  const contractId = coalesce(
    env.ILN_CONTRACT_ID,
    fileConfig.contractIds?.invoice,
    fileConfig.contractIds?.liquidity
  );
  if (!contractId) {
    throw new ConfigValidationError(
      'Missing contract ID. Set `contractIds.invoice` in your config file or `ILN_CONTRACT_ID` in the environment.'
    );
  }

  const keypairPath = coalesce(env.ILN_KEYPAIR_PATH, fileConfig.deployer?.keypairPath);
  if (!keypairPath) {
    throw new ConfigValidationError(
      'Missing keypair path. Set `deployer.keypairPath` in your config file or `ILN_KEYPAIR_PATH` in the environment.'
    );
  }

  return {
    contractId,
    keypairPath: expandHome(keypairPath, env),
    network,
    networkPassphrase: coalesce(env.ILN_NETWORK_PASSPHRASE, defaults.networkPassphrase)!,
    rpcUrl: coalesce(env.ILN_RPC_URL, fileConfig.rpcUrl, defaults.rpcUrl)!,
    tokenId: coalesce(env.ILN_TOKEN_ID, fileConfig.contractIds?.token),
  };
}

/**
 * Generate a starter `.ilnrc.json` config file in `cwd`.
 *
 * Used by `iln config init`.
 *
 * @throws if a config file already exists in that directory.
 */
export function initConfig(cwd: string): string {
  // Check whether any recognised config file already exists
  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const candidate_path = path.join(cwd, candidate);
    if (existsSync(candidate_path)) {
      throw new Error(
        `A config file already exists at ${candidate_path}. Remove it before running init.`
      );
    }
  }

  const targetPath = path.join(cwd, '.ilnrc.json');
  const template = {
    $schema: './config.schema.json',
    version: 2,
    network: 'testnet',
    rpcUrl: DEFAULTS.testnet.rpcUrl,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    contractIds: {
      invoice: '',
      token: '',
    },
    deployer: {
      keypairPath: '~/.stellar/testnet.key',
    },
    aliases: {},
  };

  writeFileSync(targetPath, JSON.stringify(template, null, 2) + '\n');
  return targetPath;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Locate and parse the first matching config file. */
/**
 * Read raw config file (for modification)
 */
export function readRawConfig(cwd: string): { rawConfig: any; filePath: string | null } {
  return readConfigFile(cwd);
}

/**
 * Write raw config to file (only supports JSON for now)
 */
export function writeRawConfig(cwd: string, rawConfig: any): string {
  let targetPath = null;
  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const candidatePath = path.join(cwd, candidate);
    if (existsSync(candidatePath)) {
      targetPath = candidatePath;
      break;
    }
  }

  if (!targetPath) {
    targetPath = path.join(cwd, '.ilnrc.json');
  }

  const ext = path.extname(targetPath).toLowerCase();
  if (ext !== '.json') {
    throw new Error('Only JSON config files are supported for writing aliases.');
  }

  writeFileSync(targetPath, JSON.stringify(rawConfig, null, 2) + '\n');
  return targetPath;
}

function readConfigFile(cwd: string): { rawConfig: unknown; filePath: string | null } {
  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const filePath = path.join(cwd, candidate);
    if (!existsSync(filePath)) continue;

    if (candidate === '.iln.config.ts') {
      return { rawConfig: loadTypeScriptConfig(filePath), filePath };
    }

    if (candidate === '.ilnrc.yaml' || candidate === '.ilnrc.yml') {
      return { rawConfig: loadYamlConfig(filePath, candidate), filePath };
    }

    // JSON files (.iln.json, .ilnrc.json)
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      return { rawConfig: raw, filePath };
    } catch (err: any) {
      throw new Error(`Failed to parse ${filePath}: ${err.message}`);
    }
  }

  return { rawConfig: {}, filePath: null };
}

function loadTypeScriptConfig(filePath: string): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(filePath);
    return mod.default ?? mod;
  } catch (err: any) {
    if (err.code === 'ERR_REQUIRE_ESM') {
      throw new Error(
        `Cannot synchronously load ESM ${filePath}. Use .ilnrc.json instead, or configure ts-node.`
      );
    }
    throw new Error(`Failed to load ${filePath}: ${err.message}`);
  }
}

function loadYamlConfig(filePath: string, candidate: string): unknown {
  let yaml: { load(src: string): unknown } | undefined;
  try {
    // Optional peer dependency — only required when YAML config is used
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    yaml = require('js-yaml') as { load(src: string): unknown };
  } catch {
    try {
      // Fallback: the 'yaml' package (different API)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const yamlPkg = require('yaml') as { parse(src: string): unknown };
      const content = readFileSync(filePath, 'utf8');
      return yamlPkg.parse(content);
    } catch {
      throw new Error(
        `Cannot parse ${candidate}: install "js-yaml" or "yaml" as a dependency (npm install js-yaml).`
      );
    }
  }
  const content = readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

function resolveNetwork(fileConfig: ILNConfigFile, env: NodeJS.ProcessEnv): SupportedNetwork {
  const value = coalesce(env.ILN_NETWORK, fileConfig.network, 'testnet');
  if (value === 'testnet' || value === 'mainnet' || value === 'standalone') {
    return value;
  }
  throw new Error(`Unsupported network "${value}". Use one of: testnet, mainnet, standalone.`);
}

function expandHome(input: string, env: NodeJS.ProcessEnv): string {
  if (!input.startsWith('~/')) {
    return input;
  }
  const home = env.HOME ?? env.USERPROFILE;
  if (!home) {
    return input;
  }
  return path.join(home, input.slice(2));
}

function coalesce(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}
