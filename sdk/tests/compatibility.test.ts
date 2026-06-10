import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkCompatibility,
  SDK_VERSION,
  MIN_CONTRACT_VERSION,
  parseVersion,
} from "../src/compatibility";

// Helper to mock invoke function
let mockInvoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockInvoke = vi.fn();
});

describe("Version Parsing", () => {
  it("parses clean version strings", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
  });

  it("handles leading 'v' prefix case-insensitively", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("V2.4.6")).toEqual([2, 4, 6]);
  });

  it("ignores pre-release or build suffixes", () => {
    expect(parseVersion("1.0.0-beta.1")).toEqual([1, 0, 0]);
    expect(parseVersion("0.1.0-alpha+build.123")).toEqual([0, 1, 0]);
  });

  it("handles incomplete version strings gracefully", () => {
    expect(parseVersion("1")).toEqual([1, 0, 0]);
    expect(parseVersion("1.2")).toEqual([1, 2, 0]);
    expect(parseVersion("")).toEqual([0, 0, 0]);
  });
});

describe("checkCompatibility (standalone)", () => {
  it("passes when contract matches SDK exactly", async () => {
    mockInvoke.mockResolvedValue("0.1.0");

    const result = await checkCompatibility(mockInvoke);
    expect(result.compatible).toBe(true);
    expect(result.contractVersion).toBe("0.1.0");
    expect(result.sdkVersion).toBe(SDK_VERSION);
    expect(result.issues).toHaveLength(0);
  });

  it("passes when contract is newer minor/patch version", async () => {
    mockInvoke.mockResolvedValue("0.1.5");

    const result = await checkCompatibility(mockInvoke);
    expect(result.compatible).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("fails when contract version is older than minimum required", async () => {
    mockInvoke.mockResolvedValue("0.0.9");

    const result = await checkCompatibility(mockInvoke);
    expect(result.compatible).toBe(false);
    expect(result.issues[0]).toContain("older than the minimum required version");
  });

  it("fails when contract version is a higher major version (potentially breaking)", async () => {
    mockInvoke.mockResolvedValue("1.0.0");

    const result = await checkCompatibility(mockInvoke);
    expect(result.compatible).toBe(false);
    expect(result.issues[0]).toContain("higher major version");
  });

  it("handles contract returning an object with a version property", async () => {
    mockInvoke.mockResolvedValue({ version: "0.1.2" });

    const result = await checkCompatibility(mockInvoke);
    expect(result.compatible).toBe(true);
    expect(result.contractVersion).toBe("0.1.2");
  });

  it("handles contract invocation failures cleanly", async () => {
    mockInvoke.mockRejectedValue(new Error("RPC Connection failed"));

    const result = await checkCompatibility(mockInvoke);
    expect(result.compatible).toBe(false);
    expect(result.contractVersion).toBe("unknown");
    expect(result.issues[0]).toContain("Failed to retrieve contract version");
  });
});
