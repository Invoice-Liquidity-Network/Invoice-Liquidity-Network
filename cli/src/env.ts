import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Environment, EnvironmentConfig } from "./types";

const ENV_CONFIG_PATH = path.join(os.homedir(), ".iln", "environments.json");

/**
 * Load environment configuration from file
 */
function loadEnvironmentConfig(): EnvironmentConfig {
  try {
    const data = fs.readFileSync(ENV_CONFIG_PATH, "utf-8");
    return JSON.parse(data) as EnvironmentConfig;
  } catch {
    return { current: null, environments: {} };
  }
}

/**
 * Save environment configuration to file
 */
function saveEnvironmentConfig(config: EnvironmentConfig): void {
  const dir = path.dirname(ENV_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ENV_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Validate environment configuration
 */
function validateEnvironment(env: Environment): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!env.name || typeof env.name !== "string") {
    errors.push("Environment name is required");
  }

  if (!env.contractId || typeof env.contractId !== "string") {
    errors.push("Contract ID is required");
  }

  if (!env.rpcUrl || typeof env.rpcUrl !== "string") {
    errors.push("RPC URL is required");
  }

  if (!env.networkPassphrase || typeof env.networkPassphrase !== "string") {
    errors.push("Network passphrase is required");
  }

  // Validate Stellar address format for contractId
  if (env.contractId && !/^G[A-Z0-9]{55}$/.test(env.contractId)) {
    errors.push("Contract ID must be a valid Stellar address (starts with G, 56 characters)");
  }

  // Validate URL format
  if (env.rpcUrl) {
    try {
      new URL(env.rpcUrl);
    } catch {
      errors.push("RPC URL must be a valid URL");
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Register environment management commands
 */
export function registerEnvCommands(program: Command): void {
  const envCommand = program
    .command("env")
    .description("Manage ILN environments");

  envCommand
    .command("list")
    .description("List all configured environments")
    .option("--json", "output machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const config = loadEnvironmentConfig();
      
      if (Object.keys(config.environments).length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ success: true, data: { environments: {}, current: null } }, null, 2));
        } else {
          console.log("No environments configured. Use 'iln env create' to add one.");
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ success: true, data: config }, null, 2));
        return;
      }

      console.log("\nConfigured Environments:");
      console.log("========================\n");
      
      for (const [name, env] of Object.entries(config.environments)) {
        const isActive = config.current === name;
        const marker = isActive ? "* " : "  ";
        console.log(`${marker}${name} ${isActive ? "(active)" : ""}`);
        console.log(`    Contract ID: ${env.contractId}`);
        console.log(`    RPC URL: ${env.rpcUrl}`);
        console.log(`    Network: ${env.networkPassphrase}`);
        if (env.keypairPath) {
          console.log(`    Keypair: ${env.keypairPath}`);
        }
        console.log();
      }
    });

  envCommand
    .command("use <name>")
    .description("Switch to a different environment")
    .action((name: string) => {
      const config = loadEnvironmentConfig();
      
      if (!config.environments[name]) {
        console.error(`Error: Environment '${name}' not found.`);
        console.error(`Available environments: ${Object.keys(config.environments).join(", ")}`);
        process.exit(1);
      }

      config.current = name;
      saveEnvironmentConfig(config);
      
      console.log(`Switched to environment: ${name}`);
      console.log(`Contract ID: ${config.environments[name].contractId}`);
      console.log(`RPC URL: ${config.environments[name].rpcUrl}`);
    });

  envCommand
    .command("create <name>")
    .description("Create a new environment")
    .requiredOption("--contract-id <id>", "Stellar contract ID")
    .requiredOption("--rpc-url <url>", "RPC server URL")
    .requiredOption("--network-passphrase <phrase>", "Stellar network passphrase")
    .option("--keypair-path <path>", "Path to keypair file")
    .action((name: string, options: { contractId: string; rpcUrl: string; networkPassphrase: string; keypairPath?: string }) => {
      const config = loadEnvironmentConfig();

      if (config.environments[name]) {
        console.error(`Error: Environment '${name}' already exists.`);
        console.error("Use 'iln env delete' to remove it first.");
        process.exit(1);
      }

      const newEnv: Environment = {
        name,
        contractId: options.contractId,
        rpcUrl: options.rpcUrl,
        networkPassphrase: options.networkPassphrase,
        keypairPath: options.keypairPath,
        isActive: false,
      };

      const validation = validateEnvironment(newEnv);
      if (!validation.valid) {
        console.error("Error: Invalid environment configuration:");
        validation.errors.forEach((err) => console.error(`  - ${err}`));
        process.exit(1);
      }

      config.environments[name] = newEnv;
      
      // Set as current if it's the first environment
      if (!config.current) {
        config.current = name;
      }

      saveEnvironmentConfig(config);
      
      console.log(`Created environment: ${name}`);
      if (config.current === name) {
        console.log(`Set as active environment.`);
      }
    });

  envCommand
    .command("delete <name>")
    .description("Delete an environment")
    .action((name: string) => {
      const config = loadEnvironmentConfig();

      if (!config.environments[name]) {
        console.error(`Error: Environment '${name}' not found.`);
        process.exit(1);
      }

      if (config.current === name) {
        console.error(`Error: Cannot delete the active environment '${name}'.`);
        console.error("Switch to another environment first using 'iln env use'.");
        process.exit(1);
      }

      // Require confirmation
      const readline = require("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(`Are you sure you want to delete environment '${name}'? (yes/no): `, (answer: string) => {
        rl.close();

        if (answer.toLowerCase() !== "yes") {
          console.log("Deletion cancelled.");
          process.exit(0);
        }

        delete config.environments[name];
        saveEnvironmentConfig(config);
        
        console.log(`Deleted environment: ${name}`);
      });
    });

  envCommand
    .command("show <name>")
    .description("Show details of a specific environment")
    .option("--json", "output machine-readable JSON")
    .action((name: string, options: { json?: boolean }) => {
      const config = loadEnvironmentConfig();

      if (!config.environments[name]) {
        if (options.json) {
          console.error(JSON.stringify({ success: false, error: `Environment '${name}' not found.` }, null, 2));
        } else {
          console.error(`Error: Environment '${name}' not found.`);
        }
        process.exit(1);
      }

      const env = config.environments[name];
      const isActive = config.current === name;

      if (options.json) {
        console.log(JSON.stringify({ success: true, data: { ...env, isActive } }, null, 2));
        return;
      }

      console.log(`\nEnvironment: ${name} ${isActive ? "(active)" : ""}`);
      console.log("========================================");
      console.log(`Contract ID: ${env.contractId}`);
      console.log(`RPC URL: ${env.rpcUrl}`);
      console.log(`Network Passphrase: ${env.networkPassphrase}`);
      if (env.keypairPath) {
        console.log(`Keypair Path: ${env.keypairPath}`);
      }
      console.log();
    });
}

/**
 * Get current environment configuration
 */
export function getCurrentEnvironment(): Environment | null {
  const config = loadEnvironmentConfig();
  if (!config.current || !config.environments[config.current]) {
    return null;
  }
  return config.environments[config.current];
}

/**
 * Get environment by name
 */
export function getEnvironment(name: string): Environment | null {
  const config = loadEnvironmentConfig();
  return config.environments[name] || null;
}
