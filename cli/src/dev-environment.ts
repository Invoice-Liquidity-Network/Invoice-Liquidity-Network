import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { Ui } from "./format";
import { withProgressBar } from "./progress";

const execFileAsync = promisify(execFile);

const CONTAINER_NAME = "stellar-local";
const QUICKSTART_IMAGE = "stellar/quickstart:testing";
const RPC_URL = "http://localhost:8000/rpc";
const FRIEND_BOT_URL = "http://localhost:8000/friendbot";
const NETWORK_PASSPHRASE = "Standalone Network ; February 2017";
const NETWORK_NAME = "local";
const ACCOUNT_NAMES = ["freelancer", "payer", "lp"] as const;
const INDEXER_PORT = 3001;
const NOTIFICATIONS_PORT = 4001;

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
    await withProgressBar(7, "Starting local environment", async (bar) => {
      bar.increment(1, "Checking Docker");
      await this.ensureDocker();

      bar.increment(1, "Starting Stellar node");
      await this.startContainer();

      bar.increment(1, "Waiting for Friendbot");
      await this.waitForFriendbot();

      bar.increment(1, "Configuring network");
      await this.ensureLocalNetwork();

      bar.increment(1, "Funding local accounts");
      await this.ensureLocalAccounts();

      bar.increment(1, "Deploying contract");
      const contractId = await this.deployContractIfPossible();

      bar.increment(1, "Writing config and starting services");
      this.writeEnvFile(contractId);
      await this.startIndexer();
      await this.startNotificationsService();
    });

    this.ui.success("Local ILN development environment is ready.");
  }

  async stop(): Promise<void> {
    await this.stopIndexer();
    await this.stopNotificationsService();
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

  async status(options?: { json?: boolean }): Promise<void> {
    const running = await this.containerRunning();
    const contractId = this.readFile(".local-contract-id") || null;
    const tokenId = this.readFile(".local-usdc-id") || null;
    const indexerRunning = await this.isPortInUse(INDEXER_PORT);
    const notificationsRunning = await this.isPortInUse(NOTIFICATIONS_PORT);

    if (options?.json) {
      this.ui.info(JSON.stringify({
        success: true,
        data: {
          node: { running, rpc: RPC_URL, network: NETWORK_NAME },
          contract: { contractId, tokenId },
          services: { indexer: { running: indexerRunning, port: INDEXER_PORT }, notifications: { running: notificationsRunning, port: NOTIFICATIONS_PORT } }
        }
      }, null, 2));
      return;
    }

    this.ui.info(`Node: ${running ? "running" : "stopped"}`);
    this.ui.info(`RPC: ${RPC_URL}`);
    this.ui.info(`Network: ${NETWORK_NAME}`);

    this.ui.info(`Contract: ${contractId || "not deployed"}`);
    this.ui.info(`Token: ${tokenId || "not deployed"}`);

    this.ui.info(`Indexer: ${indexerRunning ? "running" : "stopped"} (port ${INDEXER_PORT})`);
    this.ui.info(`Notifications: ${notificationsRunning ? "running" : "stopped"} (port ${NOTIFICATIONS_PORT})`);
  }

  private async startIndexer(): Promise<void> {
    if (await this.isPortInUse(INDEXER_PORT)) {
      this.ui.info(`Indexer is already running on port ${INDEXER_PORT}.`);
      return;
    }

    this.ui.info("Starting indexer service...");
    try {
      await this.runner.run("pnpm", ["--filter", "iln-indexer", "dev"], { cwd: this.cwd });
    } catch (error) {
      this.ui.warn(`Failed to start indexer: ${formatError(error)}`);
    }
  }

  private async stopIndexer(): Promise<void> {
    if (await this.isPortInUse(INDEXER_PORT)) {
      this.ui.info("Stopping indexer service...");
      try {
        await this.runner.run("pkill", ["-f", "iln-indexer"]);
      } catch {
        // Process may not exist
      }
    }
  }

  private async startNotificationsService(): Promise<void> {
    if (await this.isPortInUse(NOTIFICATIONS_PORT)) {
      this.ui.info(`Notifications service is already running on port ${NOTIFICATIONS_PORT}.`);
      return;
    }

    this.ui.info("Starting notifications service...");
    try {
      await this.runner.run("pnpm", ["--filter", "iln-notifications", "dev"], { cwd: this.cwd });
    } catch (error) {
      this.ui.warn(`Failed to start notifications service: ${formatError(error)}`);
    }
  }

  private async stopNotificationsService(): Promise<void> {
    if (await this.isPortInUse(NOTIFICATIONS_PORT)) {
      this.ui.info("Stopping notifications service...");
      try {
        await this.runner.run("pkill", ["-f", "iln-notifications"]);
      } catch {
        // Process may not exist
      }
    }
  }

  private async isPortInUse(port: number): Promise<boolean> {
    try {
      const result = await this.runner.run("lsof", ["-i", `:${port}`, "-t"]);
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
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
