import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { Ui } from "./format";

const execFileAsync = promisify(execFile);

const CONTAINER_NAME = "stellar-local";
const QUICKSTART_IMAGE = "stellar/quickstart:testing";
const RPC_URL = "http://localhost:8000/rpc";
const FRIEND_BOT_URL = "http://localhost:8000/friendbot";
const NETWORK_PASSPHRASE = "Standalone Network ; February 2017";
const NETWORK_NAME = "local";
const ACCOUNT_NAMES = ["freelancer", "payer", "lp"] as const;

export interface CommandResult {
  stderr: string;
  stdout: string;
}

export interface CommandRunner {
  run(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult>;
}

export interface LocalDevEnvironmentOptions {
  cwd?: string;
  runner?: CommandRunner;
  ui: Ui;
}

export class LocalDevEnvironment {
  private readonly cwd: string;
  private readonly runner: CommandRunner;
  private readonly ui: Ui;

  constructor(options: LocalDevEnvironmentOptions) {
    this.cwd = options.cwd ?? process.cwd();
    this.runner = options.runner ?? new ExecFileRunner();
    this.ui = options.ui;
  }

  async start(): Promise<void> {
    await this.ensureDocker();
    await this.startContainer();
    await this.waitForFriendbot();
    await this.ensureLocalNetwork();
    await this.ensureLocalAccounts();
    const contractId = await this.deployContractIfPossible();
    this.writeEnvFile(contractId);
    this.ui.success("Local ILN development environment is ready.");
  }

  async stop(): Promise<void> {
    if (await this.containerExists()) {
      await this.runner.run("docker", ["rm", "-f", CONTAINER_NAME]);
      this.ui.success("Stopped local Stellar node.");
      return;
    }

    this.ui.info("Local Stellar node is not running.");
  }

  async reset(): Promise<void> {
    await this.stop();
    this.removeLocalState();
    await this.start();
  }

  async status(): Promise<void> {
    const running = await this.containerRunning();
    this.ui.info(`Node: ${running ? "running" : "stopped"}`);
    this.ui.info(`RPC: ${RPC_URL}`);
    this.ui.info(`Network: ${NETWORK_NAME}`);

    const contractId = this.readFile(".local-contract-id");
    this.ui.info(`Contract: ${contractId || "not deployed"}`);

    const tokenId = this.readFile(".local-usdc-id");
    this.ui.info(`Token: ${tokenId || "not deployed"}`);
  }

  private async ensureDocker(): Promise<void> {
    try {
      await this.runner.run("docker", ["version", "--format", "{{.Server.Version}}"]);
    } catch (error) {
      throw new Error(
        `Docker is required for \`iln dev\`. Install Docker, start it, then retry. ${formatError(error)}`,
      );
    }
  }

  private async startContainer(): Promise<void> {
    if (await this.containerRunning()) {
      this.ui.info("Local Stellar node is already running.");
      return;
    }

    if (await this.containerExists()) {
      await this.runner.run("docker", ["rm", "-f", CONTAINER_NAME]);
    }

    this.ui.info("Starting local Stellar node...");
    await this.runner.run("docker", [
      "run",
      "--rm",
      "-d",
      "-p",
      "8000:8000",
      "--name",
      CONTAINER_NAME,
      QUICKSTART_IMAGE,
      "--local",
      "--enable-soroban-rpc",
    ]);
  }

  private async waitForFriendbot(): Promise<void> {
    this.ui.info("Waiting for local Friendbot...");

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(FRIEND_BOT_URL);
        if (response.status === 400 || response.ok) {
          return;
        }
      } catch {
        // Retry until the quickstart node is ready.
      }

      await delay(1000);
    }

    throw new Error("Timed out waiting for local Stellar quickstart Friendbot.");
  }

  private async ensureLocalNetwork(): Promise<void> {
    await this.runStellar([
      "network",
      "add",
      NETWORK_NAME,
      "--rpc-url",
      RPC_URL,
      "--network-passphrase",
      NETWORK_PASSPHRASE,
    ], true);
  }

  private async ensureLocalAccounts(): Promise<void> {
    for (const account of ACCOUNT_NAMES) {
      await this.runStellar(["keys", "generate", account, "--network", NETWORK_NAME], true);
      await this.runStellar(["keys", "fund", account, "--network", NETWORK_NAME], true);
    }
  }

  private async deployContractIfPossible(): Promise<string | undefined> {
    const wasmPath = this.findWasm();

    if (!wasmPath) {
      this.ui.warn("No built WASM found. Run `stellar contract build`, then rerun `iln dev start`.");
      return this.readFile(".local-contract-id") || undefined;
    }

    this.ui.info("Deploying ILN contract to local network...");
    const result = await this.runStellar([
      "contract",
      "deploy",
      "--wasm",
      wasmPath,
      "--source",
      "freelancer",
      "--network",
      NETWORK_NAME,
    ], false);

    const contractId = result.stdout.trim().split(/\s+/).pop();
    if (!contractId) {
      throw new Error("Stellar CLI did not return a local contract ID.");
    }

    writeFileSync(this.localPath(".local-contract-id"), `${contractId}\n`);
    return contractId;
  }

  private writeEnvFile(contractId?: string): void {
    const lines = [
      "# Generated by `iln dev start`",
      "ILN_NETWORK=standalone",
      `ILN_RPC_URL=${RPC_URL}`,
      `ILN_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}`,
      `ILN_CLI_LOCAL_RPC_URL=${RPC_URL}`,
      contractId ? `ILN_CONTRACT_ID=${contractId}` : "# ILN_CONTRACT_ID=",
      contractId ? `ILN_CLI_LOCAL_CONTRACT_ID=${contractId}` : "# ILN_CLI_LOCAL_CONTRACT_ID=",
      "ILN_LOCAL_FREELANCER_KEY=freelancer",
      "ILN_LOCAL_PAYER_KEY=payer",
      "ILN_LOCAL_LP_KEY=lp",
      "",
    ];

    writeFileSync(this.localPath(".env.local"), lines.join("\n"));
    this.ui.info("Wrote local settings to .env.local.");
  }

  private async runStellar(args: string[], allowFailure: boolean): Promise<CommandResult> {
    try {
      return await this.runner.run("stellar", args, { cwd: this.cwd });
    } catch (error) {
      if (allowFailure) {
        this.ui.warn(`Stellar CLI skipped ${args.join(" ")}: ${formatError(error)}`);
        return { stderr: "", stdout: "" };
      }

      throw error;
    }
  }

  private async containerExists(): Promise<boolean> {
    const result = await this.runner.run("docker", ["ps", "-a", "--filter", `name=${CONTAINER_NAME}`, "--format", "{{.Names}}"]);
    return result.stdout.split(/\r?\n/).some((line) => line.trim() === CONTAINER_NAME);
  }

  private async containerRunning(): Promise<boolean> {
    const result = await this.runner.run("docker", ["ps", "--filter", `name=${CONTAINER_NAME}`, "--format", "{{.Names}}"]);
    return result.stdout.split(/\r?\n/).some((line) => line.trim() === CONTAINER_NAME);
  }

  private removeLocalState(): void {
    for (const file of [".env.local", ".local-contract-id", ".local-usdc-id"]) {
      rmSync(this.localPath(file), { force: true });
    }
  }

  private findWasm(): string | undefined {
    const candidates = [
      path.join(this.cwd, "target", "wasm32v1-none", "release", "invoice_liquidity.wasm"),
      path.join(this.cwd, "invoice-liquidity-network", "target", "wasm32v1-none", "release", "invoice_liquidity.wasm"),
    ];

    return candidates.find((candidate) => existsSync(candidate));
  }

  private readFile(file: string): string {
    const filePath = this.localPath(file);
    return existsSync(filePath) ? readFileSync(filePath, "utf8").trim() : "";
  }

  private localPath(file: string): string {
    return path.join(this.cwd, file);
  }
}

export class ExecFileRunner implements CommandRunner {
  async run(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult> {
    const result = await execFileAsync(command, args, {
      cwd: options?.cwd,
      windowsHide: true,
    });

    return {
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
