import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalDevEnvironment, type CommandRunner } from "../src/dev-environment";
import { createUi } from "../src/format";

describe("LocalDevEnvironment", () => {
  let cwd: string;
  let runner: FakeRunner;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "iln-dev-"));
    runner = new FakeRunner();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(cwd, { force: true, recursive: true });
  });

  it("starts quickstart, prepares local accounts, and writes .env.local", async () => {
    const env = createEnvironment(cwd, runner);

    await env.start();

    expect(runner.commands).toContainEqual(
      expect.objectContaining({
        args: expect.arrayContaining(["run", "--rm", "-d", "-p", "8000:8000"]),
        command: "docker",
      }),
    );
    expect(runner.commands).toContainEqual(
      expect.objectContaining({
        args: ["keys", "generate", "freelancer", "--network", "local"],
        command: "stellar",
      }),
    );
    expect(existsSync(path.join(cwd, ".env.local"))).toBe(true);
    expect(readFileSync(path.join(cwd, ".env.local"), "utf8")).toContain("ILN_NETWORK=standalone");
  });

  it("deploys an existing built contract and records the contract ID", async () => {
    const wasmDir = path.join(cwd, "target", "wasm32v1-none", "release");
    mkdirp(wasmDir);
    writeFileSync(path.join(wasmDir, "invoice_liquidity.wasm"), "wasm");
    runner.contractId = "CLOCALCONTRACT";

    const env = createEnvironment(cwd, runner);

    await env.start();

    expect(readFileSync(path.join(cwd, ".local-contract-id"), "utf8").trim()).toBe("CLOCALCONTRACT");
    expect(readFileSync(path.join(cwd, ".env.local"), "utf8")).toContain("ILN_CONTRACT_ID=CLOCALCONTRACT");
  });

  it("reports local status", async () => {
    runner.running = true;
    writeFileSync(path.join(cwd, ".local-contract-id"), "CLOCALCONTRACT\n");
    const stdout = createMemoryStream();
    const env = new LocalDevEnvironment({
      cwd,
      runner,
      ui: createUi(stdout, createMemoryStream()),
    });

    await env.status();

    expect(stdout.toString()).toContain("Node: running");
    expect(stdout.toString()).toContain("Contract: CLOCALCONTRACT");
  });

  it("reset removes local state before starting", async () => {
    writeFileSync(path.join(cwd, ".env.local"), "old");
    runner.running = true;
    const env = createEnvironment(cwd, runner);

    await env.reset();

    expect(runner.commands).toContainEqual(
      expect.objectContaining({ args: ["rm", "-f", "stellar-local"], command: "docker" }),
    );
    expect(readFileSync(path.join(cwd, ".env.local"), "utf8")).toContain("ILN_NETWORK=standalone");
  });
});

function createEnvironment(cwd: string, runner: FakeRunner): LocalDevEnvironment {
  return new LocalDevEnvironment({
    cwd,
    runner,
    ui: createUi(createMemoryStream(), createMemoryStream()),
  });
}

class FakeRunner implements CommandRunner {
  commands: Array<{ args: string[]; command: string }> = [];
  contractId = "";
  running = false;

  async run(command: string, args: string[]) {
    this.commands.push({ args, command });

    if (command === "docker" && args[0] === "version") {
      return { stderr: "", stdout: "24.0.0\n" };
    }

    if (command === "docker" && args[0] === "ps" && args.includes("-a")) {
      return { stderr: "", stdout: this.running ? "stellar-local\n" : "" };
    }

    if (command === "docker" && args[0] === "ps") {
      return { stderr: "", stdout: this.running ? "stellar-local\n" : "" };
    }

    if (command === "docker" && args[0] === "run") {
      this.running = true;
      return { stderr: "", stdout: "container-id\n" };
    }

    if (command === "docker" && args[0] === "rm") {
      this.running = false;
      return { stderr: "", stdout: "" };
    }

    if (command === "stellar" && args[0] === "contract" && args[1] === "deploy") {
      return { stderr: "", stdout: `${this.contractId}\n` };
    }

    return { stderr: "", stdout: "" };
  }
}

function createMemoryStream(): NodeJS.WritableStream & { toString(): string } {
  let output = "";
  return Object.assign(
    {
      write(chunk: string | Buffer) {
        output += chunk.toString();
        return true;
      },
    } as NodeJS.WritableStream,
    {
      toString() {
        return output;
      },
    },
  );
}

function mkdirp(directory: string): void {
  mkdirSync(directory, { recursive: true });
}
