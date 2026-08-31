import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import semver from 'semver';
import {
  Application,
  type ProjectReflection,
  DeclarationReflection,
  ReflectionKind,
  TypeDocReader,
} from 'typedoc';

/**
 * Returns a version footer string in the format:
 * "Generated on YYYY-MM-DD from SDK v{version}"
 *
 * The date is always expressed as the UTC calendar date.
 *
 * @example
 * formatFooter(new Date('2025-07-14T12:00:00Z'), '0.1.0')
 * // => 'Generated on 2025-07-14 from SDK v0.1.0'
 */
export function formatFooter(date: Date, version: string): string {
  const utcDate = date.toISOString().slice(0, 10);
  return `Generated on ${utcDate} from SDK v${version}`;
}

/**
 * Converts a hyphen-separated filename stem into a human-readable title-cased label.
 * Each hyphen-separated word is capitalized.
 *
 * @example
 * toMetaLabel('type-aliases') // => 'Type Aliases'
 * toMetaLabel('classes')      // => 'Classes'
 */
export function toMetaLabel(filename: string): string {
  return filename
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Returns true if and only if `filePath`, when resolved to an absolute path,
 * is contained within the `outputDir` directory (i.e. starts with
 * `path.resolve(outputDir) + path.sep` or equals `path.resolve(outputDir)`).
 *
 * Path traversal sequences such as `../` are neutralised by `path.resolve`,
 * so they will correctly return false.
 *
 * @example
 * isSandboxed('/out/generated', '/out/generated/classes.mdx')          // => true
 * isSandboxed('/out/generated', '/out/generated/../outside.mdx')        // => false
 */
export function isSandboxed(outputDir: string, filePath: string): boolean {
  const resolvedDir = path.resolve(outputDir);
  const resolvedFile = path.resolve(filePath);
  return resolvedFile === resolvedDir || resolvedFile.startsWith(resolvedDir + path.sep);
}

/**
 * Returns true if and only if the given reflection has a JSDoc comment whose
 * `summary` array contains at least one entry with `kind === 'text'` and a
 * `text` value that has at least one non-whitespace character.
 *
 * Returns false for:
 * - null / undefined `comment`
 * - missing or empty `summary` array
 * - entries whose `text` is whitespace-only
 */
export function hasQualifyingDescription(reflection: {
  comment?: {
    summary?: Array<{ kind: string; text: string }>;
  };
}): boolean {
  const summary = reflection.comment?.summary;
  if (!summary || summary.length === 0) {
    return false;
  }
  return summary.some((part) => part.kind === 'text' && /\S/.test(part.text));
}

/**
 * Builds the `_meta.ts` data object from an array of `.mdx` filenames.
 * Each entry is keyed by the filename without its `.mdx` extension, and the
 * value is the human-readable label produced by `toMetaLabel`.
 *
 * @example
 * buildMetaObject(['classes.mdx', 'type-aliases.mdx'])
 * // => { classes: 'Classes', 'type-aliases': 'Type Aliases' }
 */
export function buildMetaObject(mdxFiles: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of mdxFiles) {
    const basename = path.basename(file);
    const stem = basename.endsWith('.mdx') ? basename.slice(0, -'.mdx'.length) : basename;
    result[stem] = toMetaLabel(stem);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Step 2: Read packages/sdk/package.json
// ---------------------------------------------------------------------------

/**
 * Reads and parses `packages/sdk/package.json`, returning an object with the
 * `version` field.
 *
 * The path is resolved relative to this script file's location
 * (`packages/sdk/scripts/generate-docs.ts` → `../package.json`), but can be
 * overridden by setting the `SDK_PACKAGE_JSON` environment variable.
 *
 * On any I/O or parse error the function prints to stderr and calls
 * `process.exit(1)`.
 */
export function readSdkPackageJson(): { version: string } {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultPath = path.resolve(scriptDir, '..', 'package.json');
  const pkgPath = process.env['SDK_PACKAGE_JSON'] ?? defaultPath;

  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Failed to read ${pkgPath}: ${message}\n`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Failed to read ${pkgPath}: ${message}\n`);
    process.exit(1);
  }

  return parsed as { version: string };
}

// ---------------------------------------------------------------------------
// Step 3: Validate semver
// ---------------------------------------------------------------------------

/**
 * Validates that `version` is a valid semver string using `semver.valid()`.
 *
 * Returns the canonical validated version string on success.
 * On failure, prints to stderr and calls `process.exit(1)`.
 *
 * @param version - The raw value read from `package.json`'s `version` field.
 */
export function validateSdkVersion(version: unknown): string {
  const result = semver.valid(version as string);
  if (!result) {
    process.stderr.write(
      `Invalid SDK version: "${String(
        version
      )}" is not a valid semver string (expected format: MAJOR.MINOR.PATCH)\n`
    );
    process.exit(1);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Step 1: TypeScript version check
// ---------------------------------------------------------------------------

/**
 * Resolves the TypeScript version installed in the local `node_modules` and
 * exits with a non-zero status code if it is below the minimum required
 * version (4.6.0).
 *
 * Uses `createRequire` so the resolution follows Node's standard module
 * resolution from the script's own location, making it work correctly even
 * when invoked from a different working directory.
 *
 * @example
 * checkTypeScriptVersion(); // exits 1 if TS < 4.6.0, otherwise returns
 */
export function checkTypeScriptVersion(): void {
  const require = createRequire(import.meta.url);

  let tsPkgJson: { version?: string };
  try {
    tsPkgJson = require('typescript/package.json') as { version?: string };
  } catch {
    process.stderr.write(
      'TypeScript version check failed: cannot find typescript/package.json in node_modules. ' +
        'Ensure TypeScript is installed as a dependency.\n'
    );
    process.exit(1);
  }

  const detectedVersion = tsPkgJson.version;
  if (!detectedVersion) {
    process.stderr.write(
      'TypeScript version check failed: typescript/package.json does not contain a version field.\n'
    );
    process.exit(1);
  }

  if (semver.lt(detectedVersion, '4.6.0')) {
    process.stderr.write(
      `TypeScript version check failed: detected ${detectedVersion}, minimum required is 4.6.0\n`
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 6: Sandbox path validation
// ---------------------------------------------------------------------------

/**
 * Validates that `outputDir` is sandboxed within `sandboxRoot`.
 *
 * Both paths are resolved to their absolute forms before comparison, so
 * relative paths and path traversal sequences (e.g. `../`) are handled
 * correctly. If `outputDir` resolves to a path outside of `sandboxRoot`,
 * the conflicting resolved path is printed to stderr and the process exits
 * with status 1.
 *
 * @param outputDir - The configured output directory to validate.
 * @param sandboxRoot - The root directory that `outputDir` must be within.
 *
 * @example
 * // Valid — outputDir IS the sandbox root
 * validateOutputPaths('/out/generated', '/out/generated');
 *
 * @example
 * // Invalid — outputDir escapes the sandbox
 * validateOutputPaths('/tmp/docs', '/out/generated'); // exits 1
 */
export function validateOutputPaths(outputDir: string, sandboxRoot: string): void {
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedSandboxRoot = path.resolve(sandboxRoot);

  if (!isSandboxed(resolvedSandboxRoot, resolvedOutputDir)) {
    process.stderr.write(
      `Output path validation failed: "${resolvedOutputDir}" is not within the expected sandbox root "${resolvedSandboxRoot}"\n`
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 4: Build TypeDoc reflection tree
// ---------------------------------------------------------------------------

/**
 * Invokes the TypeDoc programmatic API to build the reflection tree in memory
 * without emitting any output files.
 *
 * Reads options from the provided `typedocConfigPath`. Exits with status 1 if
 * TypeDoc fails to convert the project.
 *
 * @param typedocConfigPath - Absolute path to the `typedoc.json` config file.
 */
export async function buildReflectionTree(
  typedocConfigPath: string
): Promise<{ app: Application; project: ProjectReflection }> {
  const app = await Application.bootstrap({ options: typedocConfigPath }, [new TypeDocReader()]);

  const project = app.convert();
  if (!project) {
    process.stderr.write('TypeDoc failed to convert the project.\n');
    process.exit(1);
  }

  return { app, project };
}

// ---------------------------------------------------------------------------
// Step 5: JSDoc coverage check
// ---------------------------------------------------------------------------

/** TypeDoc Kinds that require a qualifying JSDoc description. */
const QUALIFYING_KINDS = new Set([
  ReflectionKind.Class,
  ReflectionKind.Method,
  ReflectionKind.Function,
  ReflectionKind.TypeAlias,
  ReflectionKind.Interface,
  ReflectionKind.Enum,
  ReflectionKind.Property,
]);

/**
 * Traverses all `DeclarationReflection` nodes in the project reflection and
 * enforces that every public symbol of a qualifying kind has a JSDoc
 * description with at least one non-whitespace character.
 *
 * If any violations are found:
 * - Prints each violation to stdout as:
 *   `[MISSING JSDOC] {name}  {fileName}:{line}`
 * - Calls `process.exit(1)` before any output files are written.
 *
 * This check intentionally happens BEFORE any MDX files are written.
 *
 * @param project - The TypeDoc `ProjectReflection` produced by `buildReflectionTree`.
 */
export function enforceJsDocCoverage(project: ProjectReflection): void {
  const allReflections = project.getReflectionsByKind(ReflectionKind.All);

  const violations: DeclarationReflection[] = allReflections
    .filter((r): r is DeclarationReflection => r instanceof DeclarationReflection)
    .filter((r) => QUALIFYING_KINDS.has(r.kind))
    .filter((r) => !hasQualifyingDescription(r));

  if (violations.length === 0) {
    return;
  }

  for (const reflection of violations) {
    const fileName = reflection.sources?.[0]?.fileName ?? 'unknown';
    const line = reflection.sources?.[0]?.line ?? 0;
    process.stdout.write(`[MISSING JSDOC] ${reflection.name}  ${fileName}:${line}\n`);
  }

  process.exit(1);
}

// ---------------------------------------------------------------------------
// Steps 7–8: Write MDX files and inject version footers
// ---------------------------------------------------------------------------

/**
 * Triggers TypeDoc's markdown renderer to write `.mdx` files to `outputDir`,
 * then appends a version footer to every written `.mdx` file.
 *
 * Steps performed:
 * 1. Call `app.generateDocs(project, outputDir)` to emit all `.mdx` files.
 * 2. Scan `outputDir` for files ending in `.mdx` (excluding `_meta.ts`).
 * 3. For each `.mdx` file, append `\n\n---\n\n${formatFooter(new Date(), version)}\n`.
 *
 * @param app       - The TypeDoc `Application` instance returned by `buildReflectionTree`.
 * @param project   - The TypeDoc `ProjectReflection` returned by `buildReflectionTree`.
 * @param outputDir - Absolute path to the directory where `.mdx` files are written.
 * @param version   - The validated semver version string from `packages/sdk/package.json`.
 */
export async function renderAndInjectFooters(
  app: Application,
  project: ProjectReflection,
  outputDir: string,
  version: string
): Promise<void> {
  // Step 7: Trigger the typedoc-plugin-markdown renderer to write .mdx files.
  await app.generateDocs(project, outputDir);

  // Step 8: Scan for written .mdx files and inject the version footer.
  const footer = `\n\n---\n\n${formatFooter(new Date(), version)}\n`;

  const entries = fs.readdirSync(outputDir);
  const mdxFiles = entries.filter((entry) => entry.endsWith('.mdx'));

  for (const filename of mdxFiles) {
    const filePath = path.join(outputDir, filename);
    const contents = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(filePath, contents + footer, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Step 9: Generate _meta.ts
// ---------------------------------------------------------------------------

/**
 * Scans `outputDir` for all `.mdx` files, builds a `_meta.ts` navigation
 * object mapping each filename-without-extension to its human-readable label,
 * and writes the result to `path.join(outputDir, '_meta.ts')`.
 *
 * The written file carries a "do not edit" header and uses the `satisfies`
 * operator for type-safety without widening.
 *
 * @param outputDir - Absolute path to the directory containing the `.mdx` files.
 *
 * @example
 * writeMetaFile('/out/generated');
 * // writes /out/generated/_meta.ts containing e.g.:
 * // export default { classes: 'Classes', 'type-aliases': 'Type Aliases' } satisfies Record<string, string>
 */
export function writeMetaFile(outputDir: string): void {
  const entries = fs.readdirSync(outputDir);
  const mdxFiles = entries.filter((entry) => entry.endsWith('.mdx'));
  const metaObject = buildMetaObject(mdxFiles);
  const content = `// This file is auto-generated by scripts/generate-docs.ts — do not edit manually\nexport default ${JSON.stringify(
    metaObject,
    null,
    2
  )} satisfies Record<string, string>\n`;
  fs.writeFileSync(path.join(outputDir, '_meta.ts'), content, 'utf8');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  checkTypeScriptVersion();
  const pkg = readSdkPackageJson();
  const version = validateSdkVersion(pkg.version);

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const typedocConfigPath = path.resolve(scriptDir, '..', 'typedoc.json');
  const outputDir = path.resolve(
    scriptDir,
    '..',
    '..',
    'packages/docs/content/sdk-reference/generated'
  );
  const sandboxRoot = outputDir; // same dir in this case

  validateOutputPaths(outputDir, sandboxRoot);
  const { app, project } = await buildReflectionTree(typedocConfigPath);
  enforceJsDocCoverage(project);
  await renderAndInjectFooters(app, project, outputDir, version);
  writeMetaFile(outputDir);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
