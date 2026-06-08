import type { CompatibilityResult } from "./types";

export const SDK_VERSION = "0.1.0";
export const MIN_CONTRACT_VERSION = "0.1.0";

/**
 * Parses a semantic version string into a tuple of [major, minor, patch].
 * Tolerates leading "v" or pre-release suffixes (e.g. "v1.2.3-beta.1" -> [1, 2, 3]).
 */
export function parseVersion(version: string): [number, number, number] {
  const clean = version.trim().replace(/^v/i, "").split("-")[0];
  const parts = clean.split(".").map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Checks compatibility between the SDK and a deployed contract.
 * Calls `get_version` using the provided invoke function.
 *
 * @param invoke The function used to call the contract methods (e.g. invoke("get_version"))
 */
export async function checkCompatibility(invoke: (method: string) => Promise<any>): Promise<CompatibilityResult> {
  const issues: string[] = [];
  let contractVersion = "unknown";

  try {
    const res = await invoke("get_version");
    if (typeof res === "string") {
      contractVersion = res;
    } else if (res && typeof res === "object" && "version" in res) {
      contractVersion = String(res.version);
    } else {
      contractVersion = String(res);
    }
  } catch (error: any) {
    return {
      compatible: false,
      contractVersion: "unknown",
      sdkVersion: SDK_VERSION,
      issues: [`Failed to retrieve contract version: ${error.message || String(error)}`],
    };
  }

  const [cMajor, cMinor, cPatch] = parseVersion(contractVersion);
  const [mMajor, mMinor, mPatch] = parseVersion(MIN_CONTRACT_VERSION);
  const [sMajor, sMinor, sPatch] = parseVersion(SDK_VERSION);

  // Validate minimum contract version requirement
  const isOlderThanMin =
    cMajor < mMajor ||
    (cMajor === mMajor && cMinor < mMinor) ||
    (cMajor === mMajor && cMinor === mMinor && cPatch < mPatch);

  if (isOlderThanMin) {
    issues.push(
      `Deployed contract version (${contractVersion}) is older than the minimum required version (${MIN_CONTRACT_VERSION}) supported by this SDK.`,
    );
  }

  // Detect potentially breaking contract major version mismatch
  if (cMajor > sMajor) {
    issues.push(
      `Deployed contract version (${contractVersion}) has a higher major version than the SDK (${SDK_VERSION}), which may introduce breaking changes.`,
    );
  }

  return {
    compatible: issues.length === 0,
    contractVersion,
    sdkVersion: SDK_VERSION,
    issues,
  };
}
