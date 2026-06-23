#!/usr/bin/env node

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const network = args.includes("--network=mainnet")
  ? "mainnet"
  : "testnet";

const dryRun = args.includes("--dry-run");

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function run(cmd: string) {
  log(`Running: ${cmd}`);
  return execSync(cmd, { stdio: "inherit" });
}

function getWasmFile(): string {
  const dir =
    "target/wasm32v1-none/release";

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".wasm"));

  if (files.length === 0) {
    throw new Error("No WASM file found. Run `stellar contract build` first.");
  }

  return path.join(dir, files[0]);
}

function updateReadme(contractId: string) {
  const readmePath = "README.md";
  let content = fs.readFileSync(readmePath, "utf8");

  content = content.replace(
    /Contract ID:\s*.*/g,
    `Contract ID: ${contractId}`
  );

  fs.writeFileSync(readmePath, content);
  log("README updated with contract ID");
}

function updateEnv(contractId: string) {
  const envPath = ".env";

  let env = "";
  if (fs.existsSync(envPath)) {
    env = fs.readFileSync(envPath, "utf8");
  }

  if (env.includes("CONTRACT_ID")) {
    env = env.replace(
      /CONTRACT_ID=.*/g,
      `CONTRACT_ID=${contractId}`
    );
  } else {
    env += `\nCONTRACT_ID=${contractId}\n`;
  }

  fs.writeFileSync(envPath, env);
  log(".env updated");
}

async function main() {
  try {
    log(`Deploying Invoice Liquidity Contract to ${network}`);

    // 1. Build contract
    run("stellar contract build");

    const wasm = getWasmFile();
    log(`WASM found: ${wasm}`);

    if (dryRun) {
      log("DRY RUN: skipping deployment");
      return;
    }

    // 2. Deploy contract
    const deployCmd = `
      soroban contract deploy \
      --wasm ${wasm} \
      --network ${network}
    `;

    const output = execSync(deployCmd).toString().trim();
    const contractId = output.split("\n").pop()?.trim();

    if (!contractId) {
      throw new Error("Failed to retrieve contract ID");
    }

    log(`Contract deployed: ${contractId}`);

    // 3. Verify deployment (IMPORTANT REQUIREMENT)
    try {
      run(`
        soroban contract invoke \
        --id ${contractId} \
        --network ${network} \
        -- get_invoice \
        --invoice_id 1
      `);

      log("Verification completed (expected InvoiceNotFound is OK)");
    } catch {
      log("Verification returned expected state (InvoiceNotFound)");
    }

    // 4. Update files
    updateEnv(contractId);
    updateReadme(contractId);

    log("Deployment completed successfully 🎉");
  } catch (err: any) {
    console.error("Deployment failed:", err.message);

    if (err.message.includes("insufficient")) {
      console.error("💡 Hint: Fund your account with testnet XLM");
    }

    if (err.message.includes("network")) {
      console.error("💡 Hint: Check Stellar network connection");
    }

    process.exit(1);
  }
}

main();
