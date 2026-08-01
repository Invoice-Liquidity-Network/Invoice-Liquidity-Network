import { describe, it, expect } from "vitest";
import { resolve } from "path";
import {
  readContractVersion,
  readJsonVersion,
  parseCompatibilityMatrix,
  validate,
  type MatrixRow,
} from "../check-compatibility";

const FIXTURES = resolve(import.meta.dirname, "../__fixtures__/check-compatibility");

// ---------------------------------------------------------------------------
// readContractVersion
// ---------------------------------------------------------------------------

describe("readContractVersion", () => {
  it("reads the version from a valid Cargo.toml", () => {
    const version = readContractVersion(FIXTURES);
    expect(version).toBe("0.1.0");
  });

  it("throws when the Cargo.toml has no version field", () => {
    const readFile = () => '[package]\nname = "invoice_liquidity"\nedition = "2021"\n';
    expect(() => readContractVersion(FIXTURES, readFile)).toThrow(/Could not find version/);
  });

  it("throws when the Cargo.toml is empty", () => {
    const readFile = () => "";
    expect(() => readContractVersion(FIXTURES, readFile)).toThrow(/Could not find version/);
  });

  it("extracts version even with extra fields around it", () => {
    const readFile = () =>
      '[package]\nedition = "2021"\nname = "foo"\nversion = "9.9.9"\nauthors = []\n';
    expect(readContractVersion(FIXTURES, readFile)).toBe("9.9.9");
  });
});

// ---------------------------------------------------------------------------
// readJsonVersion
// ---------------------------------------------------------------------------

describe("readJsonVersion", () => {
  it("reads the version from sdk/package.json", () => {
    const version = readJsonVersion("sdk/package.json", FIXTURES);
    expect(version).toBe("0.1.0");
  });

  it("reads the version from frontend/package.json", () => {
    const version = readJsonVersion("frontend/package.json", FIXTURES);
    expect(version).toBe("0.1.0");
  });

  it("throws when the JSON file has no version field", () => {
    const readFile = () => '{"name": "test"}';
    expect(() => readJsonVersion("sdk/package.json", FIXTURES, readFile)).toThrow(
      /No "version" field/,
    );
  });

  it("throws on malformed JSON", () => {
    const readFile = () => "{not valid json";
    expect(() => readJsonVersion("sdk/package.json", FIXTURES, readFile)).toThrow();
  });

  it("throws when the file does not exist", () => {
    expect(() => readJsonVersion("nonexistent/package.json", FIXTURES)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseCompatibilityMatrix
// ---------------------------------------------------------------------------

describe("parseCompatibilityMatrix", () => {
  it("parses the fixture matrix into MatrixRow objects", () => {
    const rows = parseCompatibilityMatrix(FIXTURES);
    expect(rows).toEqual([
      { contract: "0.1.0", sdk: "0.1.0", frontend: "0.1.0" },
      { contract: "0.1.1", sdk: "0.1.0", frontend: "0.1.0" },
      { contract: "0.2.0", sdk: "0.2.0", frontend: "0.1.0" },
    ]);
  });

  it("throws when markers are missing", () => {
    const readFile = () => "# No markers here\nSome content\n";
    expect(() => parseCompatibilityMatrix(FIXTURES, readFile)).toThrow(
      /Could not find compatibility matrix markers/,
    );
  });

  it("returns empty array when matrix block has only header and separator", () => {
    const readFile = () =>
      "<!-- COMPATIBILITY_MATRIX_START -->\n" +
      "| Contract | SDK | Frontend | Notes |\n" +
      "|---|---|---|---|\n" +
      "<!-- COMPATIBILITY_MATRIX_END -->\n";
    const rows = parseCompatibilityMatrix(FIXTURES, readFile);
    expect(rows).toEqual([]);
  });

  it("handles matrix rows without backtick-wrapped versions", () => {
    const readFile = () =>
      "<!-- COMPATIBILITY_MATRIX_START -->\n" +
      "| Contract | SDK | Frontend | Notes |\n" +
      "|---|---|---|---|\n" +
      "| 1.0.0 | 2.0.0 | 3.0.0 | plain versions |\n" +
      "<!-- COMPATIBILITY_MATRIX_END -->\n";
    const rows = parseCompatibilityMatrix(FIXTURES, readFile);
    expect(rows).toEqual([{ contract: "1.0.0", sdk: "2.0.0", frontend: "3.0.0" }]);
  });

  it("handles rows with extra columns (e.g. Notes)", () => {
    const readFile = () =>
      "<!-- COMPATIBILITY_MATRIX_START -->\n" +
      "| Contract | SDK | Frontend | Notes |\n" +
      "|---|---|---|---|\n" +
      "| `1.0.0` | `1.0.0` | `1.0.0` | Some note here |\n" +
      "<!-- COMPATIBILITY_MATRIX_END -->\n";
    const rows = parseCompatibilityMatrix(FIXTURES, readFile);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ contract: "1.0.0", sdk: "1.0.0", frontend: "1.0.0" });
  });

  it("skips separator rows with varying dash patterns", () => {
    const readFile = () =>
      "<!-- COMPATIBILITY_MATRIX_START -->\n" +
      "| Contract | SDK | Frontend |\n" +
      "|---|---|---|\n" +
      "| `1.0.0` | `1.0.0` | `1.0.0` |\n" +
      "| ------- | ----- | -------- |\n" +
      "| `2.0.0` | `2.0.0` | `2.0.0` |\n" +
      "<!-- COMPATIBILITY_MATRIX_END -->\n";
    const rows = parseCompatibilityMatrix(FIXTURES, readFile);
    expect(rows).toEqual([
      { contract: "1.0.0", sdk: "1.0.0", frontend: "1.0.0" },
      { contract: "2.0.0", sdk: "2.0.0", frontend: "2.0.0" },
    ]);
  });

  it("skips rows with fewer than 3 cells", () => {
    const readFile = () =>
      "<!-- COMPATIBILITY_MATRIX_START -->\n" +
      "| Contract | SDK | Frontend |\n" +
      "|---|---|---|\n" +
      "| `1.0.0` | `1.0.0` |\n" +
      "| `2.0.0` | `2.0.0` | `2.0.0` |\n" +
      "<!-- COMPATIBILITY_MATRIX_END -->\n";
    const rows = parseCompatibilityMatrix(FIXTURES, readFile);
    expect(rows).toEqual([{ contract: "2.0.0", sdk: "2.0.0", frontend: "2.0.0" }]);
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("validate", () => {
  const matrix: MatrixRow[] = [
    { contract: "0.1.0", sdk: "0.1.0", frontend: "0.1.0" },
    { contract: "0.1.1", sdk: "0.1.0", frontend: "0.1.0" },
    { contract: "0.2.0", sdk: "0.2.0", frontend: "0.1.0" },
  ];

  it("returns ok when the exact tuple is found in the matrix", () => {
    const result = validate("0.1.0", "0.1.0", "0.1.0", matrix);
    expect(result).toEqual({ ok: true });
  });

  it("returns ok for a different matching row", () => {
    const result = validate("0.2.0", "0.2.0", "0.1.0", matrix);
    expect(result).toEqual({ ok: true });
  });

  it("returns ok when partial version matches but full tuple does not", () => {
    // contract 0.1.1 matches row 2, but SDK 0.2.0 doesn't match any row for that contract
    const result = validate("0.1.1", "0.2.0", "0.1.0", matrix);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("NOT found in the compatibility matrix");
      expect(result.message).toContain("Contract: 0.1.0 | SDK: 0.1.0 | Frontend: 0.1.0");
    }
  });

  it("returns failure when no tuple matches", () => {
    const result = validate("9.9.9", "9.9.9", "9.9.9", matrix);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("NOT found in the compatibility matrix");
      expect(result.message).toContain("Contract: 0.1.0");
      expect(result.message).toContain("Contract: 0.2.0");
    }
  });

  it("returns failure with empty matrix message when matrix is empty", () => {
    const result = validate("0.1.0", "0.1.0", "0.1.0", []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Compatibility matrix is empty");
    }
  });

  it("reports all matrix rows in the failure message", () => {
    const result = validate("1.0.0", "1.0.0", "1.0.0", matrix);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Contract: 0.1.0 | SDK: 0.1.0 | Frontend: 0.1.0");
      expect(result.message).toContain("Contract: 0.1.1 | SDK: 0.1.0 | Frontend: 0.1.0");
      expect(result.message).toContain("Contract: 0.2.0 | SDK: 0.2.0 | Frontend: 0.1.0");
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: full flow with fixtures
// ---------------------------------------------------------------------------

describe("end-to-end with fixtures", () => {
  it("happy path: fixture versions match the fixture matrix", () => {
    const contractVersion = readContractVersion(FIXTURES);
    const sdkVersion = readJsonVersion("sdk/package.json", FIXTURES);
    const frontendVersion = readJsonVersion("frontend/package.json", FIXTURES);
    const matrix = parseCompatibilityMatrix(FIXTURES);

    const result = validate(contractVersion, sdkVersion, frontendVersion, matrix);
    expect(result).toEqual({ ok: true });
  });

  it("failure path: mismatched version produces non-ok result", () => {
    const contractVersion = readContractVersion(FIXTURES);
    const sdkVersion = "99.0.0"; // will not match
    const frontendVersion = readJsonVersion("frontend/package.json", FIXTURES);
    const matrix = parseCompatibilityMatrix(FIXTURES);

    const result = validate(contractVersion, sdkVersion, frontendVersion, matrix);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("NOT found in the compatibility matrix");
    }
  });
});
