import { Networks } from '@stellar/stellar-sdk';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { FileConfig, ResolvedConfig, SupportedNetwork } from './types';

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

export interface LoadConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(options: LoadConfigOptions = {}): ResolvedConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configPath = path.join(cwd, '.iln.json');
  const fileConfig = existsSync(configPath) ? readConfigFile(configPath) : {};
  const network = resolveNetwork(fileConfig, env);
  const defaults = DEFAULTS[network];

  const contractId = coalesce(env.ILN_CONTRACT_ID, fileConfig.contractId);
  if (!contractId) {
    throw new Error(
      'Missing contract ID. Set `contractId` in .iln.json or `ILN_CONTRACT_ID` in the environment.'
    );
  }

  const keypairPath = coalesce(env.ILN_KEYPAIR_PATH, fileConfig.keypairPath);
  if (!keypairPath) {
    throw new Error(
      'Missing keypair path. Set `keypairPath` in .iln.json or `ILN_KEYPAIR_PATH` in the environment.'
    );
  }

  return {
    contractId,
    keypairPath: expandHome(keypairPath, env),
    network,
    networkPassphrase: coalesce(
      env.ILN_NETWORK_PASSPHRASE,
      fileConfig.networkPassphrase,
      defaults.networkPassphrase
    )!,
    rpcUrl: coalesce(env.ILN_RPC_URL, fileConfig.rpcUrl, defaults.rpcUrl)!,
    tokenId: coalesce(env.ILN_TOKEN_ID, fileConfig.tokenId),
  };
}

function resolveNetwork(fileConfig: FileConfig, env: NodeJS.ProcessEnv): SupportedNetwork {
  const value = coalesce(env.ILN_NETWORK, fileConfig.network, 'testnet');
  if (value === 'testnet' || value === 'mainnet' || value === 'standalone') {
    return value;
  }

  throw new Error(`Unsupported network "${value}". Use one of: testnet, mainnet, standalone.`);
}

function readConfigFile(configPath: string): FileConfig {
  const raw = readFileSync(configPath, 'utf8');

  try {
    return JSON.parse(raw) as FileConfig;
  } catch (error) {
    throw new Error(
      `Failed to parse ${configPath}: ${error instanceof Error ? error.message : 'invalid JSON'}.`
    );
  }
}

function expandHome(input: string, env: NodeJS.ProcessEnv): string {
  if (!input.startsWith('~/')) {
    return input;
  }

  const home = env.HOME;
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
