import { Networks } from "@stellar/stellar-sdk";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ILNConfig {
  network: "testnet" | "mainnet";
  secretKey?: string;
  contractId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}

const DEFAULTS = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
  },
  mainnet: {
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: Networks.PUBLIC,
  },
};

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(home, ".iln", "config.json");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ILNConfig {
  const configPath = getConfigPath(env);
  let fileConfig: Partial<ILNConfig> = {};

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf8");
      fileConfig = JSON.parse(raw);
    } catch (error) {
      // Ignore or throw? Let's throw an actionable error if the config file is corrupted
      throw new Error(
        `Failed to parse config file at ${configPath}: ${
          error instanceof Error ? error.message : "Invalid JSON"
        }`
      );
    }
  }

  // Resolve network: Env -> File -> Default "testnet"
  const envNetwork = env.ILN_NETWORK;
  let network: "testnet" | "mainnet" = "testnet";
  const rawNetwork = envNetwork || fileConfig.network || "testnet";
  if (rawNetwork === "mainnet") {
    network = "mainnet";
  } else if (rawNetwork === "testnet") {
    network = "testnet";
  } else {
    throw new Error(
      `Unsupported network "${rawNetwork}". Supported networks are: testnet, mainnet.`
    );
  }

  const defaults = DEFAULTS[network];

  // Resolve contractId, secretKey, rpcUrl, networkPassphrase
  const contractId = env.ILN_CONTRACT_ID || fileConfig.contractId;
  const secretKey = env.ILN_SECRET_KEY || fileConfig.secretKey;
  const rpcUrl = fileConfig.rpcUrl || defaults.rpcUrl;
  const networkPassphrase = fileConfig.networkPassphrase || defaults.networkPassphrase;

  return {
    network,
    secretKey,
    contractId,
    rpcUrl,
    networkPassphrase,
  };
}

export function saveConfig(partialConfig: Partial<ILNConfig>, env: NodeJS.ProcessEnv = process.env): void {
  const configPath = getConfigPath(env);
  const dir = path.dirname(configPath);

  let existing: Partial<ILNConfig> = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      // Ignore reading error, overwrite
    }
  }

  const updated = {
    ...existing,
    ...partialConfig,
  };

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf8");
  } catch (error) {
    throw new Error(
      `Failed to write config file to ${configPath}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
