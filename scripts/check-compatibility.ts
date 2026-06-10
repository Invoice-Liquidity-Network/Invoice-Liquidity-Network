/**
 * scripts/check-compatibility.ts
 *
 * CI check that validates the current contract, SDK, and frontend versions
 * are present in the compatibility matrix in docs/cross-repo-dependencies.md.
 *
 * Usage:
 *   npx ts-node --esm scripts/check-compatibility.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname ?? __dirname, "..");

// ---------------------------------------------------------------------------
// 1. Read current versions from source files
// ---------------------------------------------------------------------------

function readContractVersion(): string {
  const cargoPath = resolve(ROOT, "backend/contracts/invoice_liquidity/Cargo.toml");
  const content = readFileSync(cargoPath, "utf-8");
  const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not find version in ${cargoPath}`);
  }
  return match[1];
}

function readJsonVersion(relativePath: string): string {
  const fullPath = resolve(ROOT, relativePath);
  const content = readFileSync(fullPath, "utf-8");
  const json = JSON.parse(content) as { version?: string };
  if (!json.version) {
    throw new Error(`No "version" field in ${fullPath}`);
  }
  return json.version;
}

// ---------------------------------------------------------------------------
// 2. Parse compatibility matrix from markdown
// ---------------------------------------------------------------------------

interface MatrixRow {
  contract: string;
  sdk: string;
  frontend: string;
}

function parseCompatibilityMatrix(): MatrixRow[] {
  const docPath = resolve(ROOT, "docs/cross-repo-dependencies.md");
  const content = readFileSync(docPath, "utf-8");

  const startMarker = "<!-- COMPATIBILITY_MATRIX_START -->";
  const endMarker = "<!-- COMPATIBILITY_MATRIX_END -->";

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Could not find compatibility matrix markers in ${docPath}. ` +
      `Expected ${startMarker} and ${endMarker}.`
    );
  }

  const matrixBlock = content.slice(startIdx + startMarker.length, endIdx);
  const lines = matrixBlock.split("\n").filter((line) => line.trim().startsWith("|"));

  // Skip header row and separator row (lines starting with |---)
  const dataLines = lines.filter((line) => {
    const trimmed = line.trim();
    // Skip separator rows like |---|---|---|---|
    if (/^\|[\s-|]+\|$/.test(trimmed)) return false;
    // Skip header row (first non-separator row with column names)
    if (trimmed.includes("Contract") && trimmed.includes("SDK") && trimmed.includes("Frontend")) {
      return false;
    }
    return true;
  });

  const rows: MatrixRow[] = [];

  for (const line of dataLines) {
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);

    if (cells.length < 3) continue;

    // Extract version strings — they are wrapped in backticks like `0.1.0`
    const extractVersion = (cell: string): string => {
      const match = cell.match(/`([^`]+)`/);
      return match ? match[1] : cell;
    };

    rows.push({
      contract: extractVersion(cells[0]),
      sdk: extractVersion(cells[1]),
      frontend: extractVersion(cells[2]),
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// 3. Main validation
// ---------------------------------------------------------------------------

function main(): void {
  console.log("🔍 Checking cross-repo version compatibility...\n");

  const contractVersion = readContractVersion();
  const sdkVersion = readJsonVersion("sdk/package.json");
  const frontendVersion = readJsonVersion("frontend/package.json");

  console.log(`  Contract (invoice_liquidity): ${contractVersion}`);
  console.log(`  SDK (@invoice-liquidity/sdk): ${sdkVersion}`);
  console.log(`  Frontend (ILN-Frontend):      ${frontendVersion}`);
  console.log();

  const matrix = parseCompatibilityMatrix();

  if (matrix.length === 0) {
    console.error("❌ Compatibility matrix is empty! Add at least one row to docs/cross-repo-dependencies.md.");
    process.exit(1);
  }

  const match = matrix.find(
    (row) =>
      row.contract === contractVersion &&
      row.sdk === sdkVersion &&
      row.frontend === frontendVersion
  );

  if (match) {
    console.log("✅ Current version combination found in the compatibility matrix.");
    process.exit(0);
  } else {
    console.error("❌ Current version combination NOT found in the compatibility matrix!\n");
    console.error("   Expected one of these rows to match:");
    for (const row of matrix) {
      console.error(`     Contract: ${row.contract} | SDK: ${row.sdk} | Frontend: ${row.frontend}`);
    }
    console.error(
      "\n   Please update docs/cross-repo-dependencies.md with the new version combination."
    );
    process.exit(1);
  }
}

main();
