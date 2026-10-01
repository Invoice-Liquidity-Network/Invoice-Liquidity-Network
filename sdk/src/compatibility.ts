import type { CompatibilityResult } from './types';

/** Current SDK version. */
export const SDK_VERSION = '0.1.0';
/** Minimum contract version required by this SDK. */
export const MIN_CONTRACT_VERSION = '0.1.0';

export interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export interface DeprecationWarning {
  method: string;
  message: string;
  alternative?: string;
  removedIn?: string;
}

export interface MigrationGuide {
  fromVersion: string;
  toVersion: string;
  changes: MigrationChange[];
}

export interface MigrationChange {
  type: 'breaking' | 'deprecated' | 'added' | 'removed';
  description: string;
  migration?: string;
}

const DEPRECATION_WARNINGS: DeprecationWarning[] = [
  {
    method: 'getVersion',
    message: 'getVersion() is deprecated. Use checkCompatibility() instead.',
    alternative: 'checkCompatibility',
    removedIn: '1.0.0',
  },
  {
    method: 'getContractVersion',
    message: 'getContractVersion() is deprecated. Use checkCompatibility() instead.',
    alternative: 'checkCompatibility',
    removedIn: '1.0.0',
  },
];

/**
 * Parse a semantic version string into a VersionInfo object.
 * Tolerates leading "v" or pre-release suffixes (e.g. "v1.2.3-beta.1").
 *
 * @param version - The version string to parse.
 * @returns The parsed version components.
 *
 * @example
 * ```ts
 * const v = parseVersion("v1.2.3-beta.1");
 * console.log(v.major, v.minor, v.patch); // 1, 2, 3
 * ```
 */
export function parseVersion(version: string): VersionInfo {
  const clean = version.trim().replace(/^v/i, '').split('-')[0];
  const parts = clean.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
    raw: version,
  };
}

/**
 * Compare two semantic version strings.
 *
 * @param a - First version string.
 * @param b - Second version string.
 * @returns -1 if a < b, 0 if a === b, 1 if a > b.
 *
 * @example
 * ```ts
 * compareVersions("1.0.0", "2.0.0"); // -1
 * compareVersions("1.0.0", "1.0.0"); // 0
 * compareVersions("2.0.0", "1.0.0"); // 1
 * ```
 */
export function compareVersions(a: string, b: string): number {
  const versionA = parseVersion(a);
  const versionB = parseVersion(b);

  if (versionA.major !== versionB.major) {
    return versionA.major < versionB.major ? -1 : 1;
  }
  if (versionA.minor !== versionB.minor) {
    return versionA.minor < versionB.minor ? -1 : 1;
  }
  if (versionA.patch !== versionB.patch) {
    return versionA.patch < versionB.patch ? -1 : 1;
  }
  return 0;
}

/**
 * Check if a version string falls within a compatible range.
 *
 * @param version - The version to check.
 * @param minVersion - The minimum acceptable version.
 * @param maxVersion - Optional maximum acceptable version.
 * @returns `true` if the version is within the range.
 *
 * @example
 * ```ts
 * isVersionCompatible("1.5.0", "1.0.0", "2.0.0"); // true
 * isVersionCompatible("0.9.0", "1.0.0");          // false
 * ```
 */
export function isVersionCompatible(
  version: string,
  minVersion: string,
  maxVersion?: string
): boolean {
  const compareMin = compareVersions(version, minVersion);
  if (compareMin < 0) return false;

  if (maxVersion) {
    const compareMax = compareVersions(version, maxVersion);
    if (compareMax > 0) return false;
  }

  return true;
}

/**
 * Detect the current SDK version.
 *
 * @returns The SDK version as a VersionInfo object.
 */
export function detectSdkVersion(): VersionInfo {
  return parseVersion(SDK_VERSION);
}

/**
 * Check compatibility between the SDK and a deployed contract.
 * Calls `get_version` on the contract to retrieve its version.
 *
 * @param invoke - A function that invokes a contract method by name.
 * @returns A compatibility result with version info and any issues found.
 *
 * @example
 * ```ts
 * const result = await checkCompatibility(async (method) => {
 *   if (method === "get_version") return contract.getVersion();
 *   throw new Error("Unsupported method");
 * });
 *
 * if (!result.compatible) {
 *   console.warn("Compatibility issues:", result.issues);
 * }
 * ```
 */
export async function checkCompatibility(
  invoke: (method: string) => Promise<any>
): Promise<CompatibilityResult> {
  const issues: string[] = [];
  let contractVersion = 'unknown';

  try {
    const res = await invoke('get_version');
    if (typeof res === 'string') {
      contractVersion = res;
    } else if (res && typeof res === 'object' && 'version' in res) {
      contractVersion = String(res.version);
    } else {
      contractVersion = String(res);
    }
  } catch (error: any) {
    return {
      compatible: false,
      contractVersion: 'unknown',
      sdkVersion: SDK_VERSION,
      issues: [`Failed to retrieve contract version: ${error.message || String(error)}`],
    };
  }

  const contract = parseVersion(contractVersion);
  const sdk = parseVersion(SDK_VERSION);

  if (isVersionCompatible(contractVersion, MIN_CONTRACT_VERSION) === false) {
    issues.push(
      `Deployed contract version (${contractVersion}) is older than the minimum required version (${MIN_CONTRACT_VERSION}) supported by this SDK.`
    );
  }

  if (contract.major > sdk.major) {
    issues.push(
      `Deployed contract version (${contractVersion}) has a higher major version than the SDK (${SDK_VERSION}), which may introduce breaking changes.`
    );
  }

  return {
    compatible: issues.length === 0,
    contractVersion,
    sdkVersion: SDK_VERSION,
    issues,
  };
}

/**
 * Get deprecation warnings for a specific method.
 *
 * @param method - The method name to check.
 * @returns The deprecation warning, or undefined if the method is not deprecated.
 *
 * @example
 * ```ts
 * const warning = getDeprecationWarning("getVersion");
 * if (warning) {
 *   console.warn(warning.message);
 * }
 * ```
 */
export function getDeprecationWarning(method: string): DeprecationWarning | undefined {
  return DEPRECATION_WARNINGS.find((w) => w.method === method);
}

/**
 * Get all deprecation warnings for the current SDK version.
 *
 * @returns Array of all deprecation warnings.
 */
export function getAllDeprecationWarnings(): DeprecationWarning[] {
  return [...DEPRECATION_WARNINGS];
}

/**
 * Wrap a method call with automatic deprecation warning logging.
 * If the method is deprecated, logs a warning before executing.
 *
 * @param method - The method name to check for deprecation.
 * @param fn - The function to execute.
 * @param logger - Optional custom logger (defaults to `console.warn`).
 * @returns The return value of `fn`.
 *
 * @example
 * ```ts
 * const result = withDeprecationWarning(
 *   "getVersion",
 *   () => oldGetVersion(),
 *   console.warn,
 * );
 * ```
 */
export function withDeprecationWarning<T>(
  method: string,
  fn: () => T,
  logger?: (message: string) => void
): T {
  const warning = getDeprecationWarning(method);
  if (warning) {
    const log = logger ?? console.warn;
    log(`[DEPRECATED] ${warning.message}`);
    if (warning.alternative) {
      log(`[DEPRECATED] Use ${warning.alternative} instead.`);
    }
    if (warning.removedIn) {
      log(`[DEPRECATED] This method will be removed in version ${warning.removedIn}.`);
    }
  }
  return fn();
}

/**
 * Generate a migration guide describing changes between two SDK versions.
 *
 * @param fromVersion - The source version to migrate from.
 * @param toVersion - The target version to migrate to.
 * @returns A migration guide with breaking changes, deprecations, and additions.
 *
 * @example
 * ```ts
 * const guide = getMigrationGuide("0.1.0", "1.0.0");
 * guide.changes.forEach(change => {
 *   console.log(`[${change.type}] ${change.description}`);
 * });
 * ```
 */
export function getMigrationGuide(fromVersion: string, toVersion: string): MigrationGuide {
  const changes: MigrationChange[] = [];

  const from = parseVersion(fromVersion);
  const to = parseVersion(toVersion);

  if (to.major > from.major) {
    changes.push({
      type: 'breaking',
      description: 'Major version bump indicates breaking changes.',
      migration: 'Review the changelog for breaking changes and update your code accordingly.',
    });
  }

  if (to.minor > from.minor) {
    changes.push({
      type: 'added',
      description: 'New features have been added in this version.',
    });
  }

  DEPRECATION_WARNINGS.forEach((warning) => {
    if (warning.removedIn && isVersionCompatible(warning.removedIn, fromVersion, toVersion)) {
      changes.push({
        type: 'deprecated',
        description: `${warning.method}: ${warning.message}`,
        migration: warning.alternative ? `Migrate to ${warning.alternative}.` : undefined,
      });
    }
  });

  return {
    fromVersion,
    toVersion,
    changes,
  };
}
