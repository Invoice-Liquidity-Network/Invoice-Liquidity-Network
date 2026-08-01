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

type ReadFile = (fullPath: string) => string;

const defaultReadFile: ReadFile = (fullPath) => readFileSync(fullPath, "utf-8");

// ---------------------------------------------------------------------------
// 1. Read current versions from source files
// ---------------------------------------------------------------------------

export function readContractVersion(root: string = ROOT, readFile: ReadFile = defaultReadFile): string {
  const cargoPath = resolve(root, "backend/contracts/invoice_liquidity/Cargo.toml");
  const content = readFile(cargoPath);
  const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not find version in ${cargoPath}`);
  }
  return match[1];
}

export function readJsonVersion(
  relativePath: string,
  root: string = ROOT,
  readFile: ReadFile = defaultReadFile,
): string {
  const fullPath = resolve(root, relativePath);
  const content = readFile(fullPath);
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

export function parseCompatibilityMatrix(
  root: string = ROOT,
  readFile: ReadFile = defaultReadFile,
): MatrixRow[] {
  const docPath = resolve(root, "docs/cross-repo-dependencies.md");
  const content = readFile(docPath);

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

export function validate(
  contractVersion: string,
  sdkVersion: string,
  frontendVersion: string,
  matrix: MatrixRow[],
): { ok: true } | { ok: false; message: string } {
  if (matrix.length === 0) {
    return {
      ok: false,
      message:
        "❌ Compatibility matrix is empty! Add at least one row to docs/cross-repo-dependencies.md.",
    };
  }

  const match = matrix.find(
    (row) =>
      row.contract === contractVersion &&
      row.sdk === sdkVersion &&
      row.frontend === frontendVersion,
  );

  if (match) {
    return { ok: true };
  }

  const rows = matrix
    .map((r) => `     Contract: ${r.contract} | SDK: ${r.sdk} | Frontend: ${r.frontend}`)
    .join("\n");

  return {
    ok: false,
    message:
      `❌ Current version combination NOT found in the compatibility matrix!\n\n` +
      `   Expected one of these rows to match:\n${rows}\n\n` +
      `   Please update docs/cross-repo-dependencies.md with the new version combination.`,
  };
}

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

  const result = validate(contractVersion, sdkVersion, frontendVersion, matrix);

  if (result.ok) {
    console.log("✅ Current version combination found in the compatibility matrix.");
    process.exit(0);
  } else {
    console.error(result.message);
    process.exit(1);
  }
}

// Only run main() when executed directly (not when imported by tests).
if (process.argv[1]?.includes("check-compatibility")) {
  main();
}
