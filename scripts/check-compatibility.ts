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

export const ROOT = resolve(import.meta.dirname ?? __dirname, "..");

// ---------------------------------------------------------------------------
// 1. Read current versions from source files
// ---------------------------------------------------------------------------

export function readContractVersion(rootPath: string = ROOT): string {
  const cargoPath = resolve(rootPath, "backend/contracts/invoice_liquidity/Cargo.toml");
  const content = readFileSync(cargoPath, "utf-8");
  const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not find version in ${cargoPath}`);
  }
  return match[1];
}

export function readJsonVersion(relativePath: string, rootPath: string = ROOT): string {
  const fullPath = resolve(rootPath, relativePath);
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

export interface MatrixRow {
  contract: string;
  sdk: string;
  frontend: string;
}

export function parseCompatibilityMatrix(docPathCustom?: string): MatrixRow[] {
  const docPath = docPathCustom ?? resolve(ROOT, "docs/cross-repo-dependencies.md");
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
    if (/^\|[\s-|]+\|$/.test(trimmed)) return false;
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

export function validateCompatibility(rootPath: string = ROOT, docPathCustom?: string): { success: boolean; message: string } {
  const contractVersion = readContractVersion(rootPath);
  const sdkVersion = readJsonVersion("sdk/package.json", rootPath);
  const frontendVersion = readJsonVersion("frontend/package.json", rootPath);

  const matrix = parseCompatibilityMatrix(docPathCustom ?? resolve(rootPath, "docs/cross-repo-dependencies.md"));

  if (matrix.length === 0) {
    return { success: false, message: "Compatibility matrix is empty!" };
  }

  const match = matrix.find(
    (row) =>
      row.contract === contractVersion &&
      row.sdk === sdkVersion &&
      row.frontend === frontendVersion
  );

  if (match) {
    return { success: true, message: "Current version combination found in the compatibility matrix." };
  } else {
    return { success: false, message: "Current version combination NOT found in the compatibility matrix!" };
  }
}

export function main(): void {
  console.log("🔍 Checking cross-repo version compatibility...\n");

  const contractVersion = readContractVersion();
  const sdkVersion = readJsonVersion("sdk/package.json");
  const frontendVersion = readJsonVersion("frontend/package.json");

  console.log(`  Contract (invoice_liquidity): ${contractVersion}`);
  console.log(`  SDK (@invoice-liquidity/sdk): ${sdkVersion}`);
  console.log(`  Frontend (ILN-Frontend):      ${frontendVersion}`);
  console.log();

  const res = validateCompatibility();

  if (res.success) {
    console.log(`✅ ${res.message}`);
    process.exit(0);
  } else {
    console.error(`❌ ${res.message}\n`);
    process.exit(1);
  }
}

// Run main only when executed directly from CLI
if (process.argv[1] && (process.argv[1].endsWith("check-compatibility.ts") || process.argv[1].endsWith("check-compatibility.js"))) {
  main();
}
