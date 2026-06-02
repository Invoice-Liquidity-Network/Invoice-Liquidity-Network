import { Networks } from "@stellar/stellar-sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { ResolvedConfig, SupportedNetwork } from "./types";

const DEFAULTS: Record<SupportedNetwork, { networkPassphrase: string; rpcUrl: string }> = {
  mainnet: {
    networkPassphrase: Networks.PUBLIC,
    rpcUrl: "https://mainnet.sorobanrpc.com",
  },
  standalone: {
    networkPassphrase: Networks.STANDALONE,
    rpcUrl: "http://localhost:8000/soroban/rpc",
  },
  testnet: {
    networkPassphrase: Networks.TESTNET,
    rpcUrl: "https://soroban-testnet.stellar.org",
  },
};

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export const ConfigSchema = z.object({
  network: z.enum(["testnet", "mainnet", "standalone"]).optional().default("testnet"),
  horizonUrl: z.string().url().optional(),
  rpcUrl: z.string().url().optional(),
  contractIds: z.record(z.string()),
  deployer: z.object({
    keypairPath: z.string().optional()
  }).optional()
});

export type ILNConfigFile = z.infer<typeof ConfigSchema>;

export interface LoadConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(options: LoadConfigOptions = {}): ResolvedConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  
  const tsConfigPath = path.join(cwd, ".iln.config.ts");
  const jsonConfigPath = path.join(cwd, ".iln.json");
  
  let rawConfig: any = {};
  
  if (existsSync(tsConfigPath)) {
    // If it's a TS file, we can't easily require it synchronously without a loader.
    // In a real app we'd use jiti or require('ts-node/register').
    // Since we are running in an environment that might use ts-node, let's try requiring it.
    try {
      const mod = require(tsConfigPath);
      rawConfig = mod.default || mod;
    } catch (err: any) {
      if (err.code === "ERR_REQUIRE_ESM") {
        throw new Error("Cannot synchronously load ESM .iln.config.ts in this environment. Consider using .iln.json or configuring ts-node.");
      }
      throw new Error(`Failed to load ${tsConfigPath}: ${err.message}`);
    }
  } else if (existsSync(jsonConfigPath)) {
    try {
      rawConfig = JSON.parse(readFileSync(jsonConfigPath, "utf8"));
    } catch (err: any) {
      throw new Error(`Failed to parse ${jsonConfigPath}: ${err.message}`);
    }
  }

  // Validate shape
  const parsed = ConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    const messages = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ConfigValidationError(`Config validation failed: ${messages}`);
  }

  const fileConfig = parsed.data;
  const network = resolveNetwork(fileConfig, env);
  const defaults = DEFAULTS[network];

  // Map to the legacy ResolvedConfig shape the CLI expects
  // Support both old ILN_CONTRACT_ID env var and new contractIds
  const contractId = coalesce(env.ILN_CONTRACT_ID, fileConfig.contractIds?.invoice, fileConfig.contractIds?.liquidity);
  if (!contractId) {
    throw new ConfigValidationError("Missing contract ID. Set `contractIds.invoice` in .iln.config.ts or `ILN_CONTRACT_ID` in the environment.");
  }

  // Support legacy keypair logic
  const keypairPath = coalesce(env.ILN_KEYPAIR_PATH, fileConfig.deployer?.keypairPath, (rawConfig as any).keypairPath);
  if (!keypairPath) {
    throw new ConfigValidationError("Missing keypair path. Set `deployer.keypairPath` in config or `ILN_KEYPAIR_PATH` in the environment.");
  }

  return {
    contractId,
    keypairPath: expandHome(keypairPath, env),
    network,
    networkPassphrase: coalesce(
      env.ILN_NETWORK_PASSPHRASE,
      (rawConfig as any).networkPassphrase,
      defaults.networkPassphrase,
    )!,
    rpcUrl: coalesce(env.ILN_RPC_URL, fileConfig.rpcUrl, defaults.rpcUrl)!,
    tokenId: coalesce(env.ILN_TOKEN_ID, fileConfig.contractIds?.token, (rawConfig as any).tokenId),
  };
}

export function scaffoldConfig(cwd: string) {
  const tsConfigPath = path.join(cwd, ".iln.config.ts");
  if (existsSync(tsConfigPath)) {
    throw new Error(`${tsConfigPath} already exists.`);
  }

  const template = `export default {
  network: "testnet",
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  contractIds: {
    invoice: "",
    token: ""
  },
  deployer: {
    keypairPath: "~/.stellar/testnet.key"
  }
};
`;
  writeFileSync(tsConfigPath, template);
  return tsConfigPath;
}

function resolveNetwork(fileConfig: ILNConfigFile, env: NodeJS.ProcessEnv): SupportedNetwork {
  const value = coalesce(env.ILN_NETWORK, fileConfig.network, "testnet");
  if (value === "testnet" || value === "mainnet" || value === "standalone") {
    return value;
  }
  throw new Error(`Unsupported network "${value}". Use one of: testnet, mainnet, standalone.`);
}

function expandHome(input: string, env: NodeJS.ProcessEnv): string {
  if (!input.startsWith("~/")) {
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
