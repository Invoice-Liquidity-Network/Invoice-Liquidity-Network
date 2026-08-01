#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const configPath = path.join(__dirname, "..", "sdk", ".bundle-size.json");
const sdkDir = path.join(__dirname, "..", "sdk");

if (!fs.existsSync(configPath)) {
  console.error("Missing bundle-size config at sdk/.bundle-size.json");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

function parseLimit(limit) {
  const match = limit.match(/^([\d.]+)\s*(KB|MB|B)$/i);
  if (!match) throw new Error(`Invalid limit format: ${limit}`);
  const value = Number.parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  switch (unit) {
    case "B":
      return value;
    case "KB":
      return value * 1024;
    case "MB":
      return value * 1024 * 1024;
    default:
      return value;
  }
}

let hasFailures = false;

for (const budget of config.budgets) {
  const filePath = path.join(sdkDir, budget.path);
  if (!fs.existsSync(filePath)) {
    console.error(`MISSING: ${budget.path}`);
    hasFailures = true;
    continue;
  }

  const stat = fs.statSync(filePath);
  const size = stat.size;
  const limit = parseLimit(budget.limit);
  const sizeKB = (size / 1024).toFixed(2);
  const limitDisplay = budget.limit;

  if (size > limit) {
    console.error(
      `OVER BUDGET: ${budget.path} is ${sizeKB} KB (limit: ${limitDisplay})`
    );
    hasFailures = true;
  } else {
    console.log(
      `OK: ${budget.path} is ${sizeKB} KB (limit: ${limitDisplay})`
    );
  }
}

if (hasFailures) {
  console.error(
    "\nBundle size budget exceeded. If this increase is intentional, update sdk/.bundle-size.json."
  );
  process.exit(1);
}

console.log("\nAll bundle sizes within budget.");
