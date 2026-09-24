#!/usr/bin/env node
/**
 * generate-sdk-api-snapshot.mjs
 *
 * Builds a deterministic JSON snapshot of the public API surface of `@iln/sdk`
 * (entry: sdk/src/index.ts) using the TypeScript compiler API, and optionally
 * writes it to sdk/api-snapshot.json.
 *
 * Usage:
 *   node scripts/generate-sdk-api-snapshot.mjs [--out <path>]
 *
 * The snapshot is the baseline that scripts/check-sdk-api-breaking-changes.mjs
 * diffs against so that semver-breaking API changes are caught in CI
 * (Issue #1029).
 *
 * Output is deterministic: export names, member names and object keys are
 * sorted, and there are no timestamps.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(REPO_ROOT, 'sdk', 'src', 'index.ts');
const CONFIG_PATH = resolve(REPO_ROOT, 'sdk', 'tsconfig.json');
export const SNAPSHOT_PATH = resolve(REPO_ROOT, 'sdk', 'api-snapshot.json');

const TYPE_FLAGS =
  ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope;

function sortObject(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key];
  return out;
}

function resolveAlias(checker, symbol) {
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      const aliased = checker.getAliasedSymbol(symbol);
      if (aliased && !(aliased.flags & ts.SymbolFlags.Transient && !aliased.declarations)) {
        return aliased;
      }
    } catch {
      // fall through — keep the original symbol
    }
  }
  return symbol;
}

function serializeSignature(checker, decl) {
  const signature = checker.getSignatureFromDeclaration(decl);
  const params = signature ? signature.getParameters() : decl.parameters ?? [];
  const paramNodes = decl.parameters ?? [];
  return {
    typeParams: (decl.typeParameters ?? []).map((p) => p.name.text),
    params: params.map((sym, i) => {
      const node = paramNodes[i] ?? sym.valueDeclaration ?? decl;
      const type = checker.getTypeOfSymbolAtLocation(sym, node);
      return {
        name: sym.name,
        type: checker.typeToString(type, decl, TYPE_FLAGS),
        optional: !!(sym.flags & ts.SymbolFlags.Optional) || !!node?.questionToken,
        rest: !!(node && ts.isParameter(node) && node.dotDotDotToken),
      };
    }),
    returnType: signature
      ? checker.typeToString(checker.getReturnTypeOfSignature(signature), decl, TYPE_FLAGS)
      : 'unknown',
  };
}

function serializeObjectMembers(checker, type, decl) {
  const members = {};
  for (const prop of type.getProperties()) {
    const propDecl = prop.valueDeclaration ?? prop.declarations?.[0] ?? decl;
    if (propDecl) {
      const mods = ts.getCombinedModifierFlags(propDecl);
      if (mods & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue;
      if (propDecl.name && ts.isPrivateIdentifier(propDecl.name)) continue;
    }
    const propType = checker.getTypeOfSymbolAtLocation(prop, propDecl ?? decl);
    const callSigs = propType.getCallSignatures();
    members[prop.name] = {
      type: checker.typeToString(propType, propDecl ?? decl, TYPE_FLAGS),
      optional: !!(prop.flags & ts.SymbolFlags.Optional),
      ...(callSigs.length > 0 ? { callable: true } : {}),
    };
  }
  return sortObject(members);
}

function serializeSymbol(checker, symbol, entryFile) {
  const sym = resolveAlias(checker, symbol);
  const decls = sym.declarations ?? [];

  const enumDecl = decls.find(ts.isEnumDeclaration);
  if (enumDecl) {
    const members = {};
    for (const m of enumDecl.members) {
      const value = checker.getConstantValue(m);
      members[m.name.getText()] = value ?? null;
    }
    return { kind: 'enum', members: sortObject(members) };
  }

  const classDecl = decls.find(ts.isClassDeclaration);
  if (classDecl) {
    const instanceType = checker.getDeclaredTypeOfSymbol(sym);
    return {
      kind: 'class',
      typeParams: (classDecl.typeParameters ?? []).map((p) => p.name.text),
      members: serializeObjectMembers(checker, instanceType, classDecl),
    };
  }

  const ifaceDecl = decls.find(ts.isInterfaceDeclaration);
  if (ifaceDecl) {
    const instanceType = checker.getDeclaredTypeOfSymbol(sym);
    return {
      kind: 'interface',
      typeParams: (ifaceDecl.typeParameters ?? []).map((p) => p.name.text),
      members: serializeObjectMembers(checker, instanceType, ifaceDecl),
    };
  }

  const typeAliasDecl = decls.find(ts.isTypeAliasDeclaration);
  if (typeAliasDecl) {
    const type = checker.getDeclaredTypeOfSymbol(sym);
    return { kind: 'type', type: checker.typeToString(type, typeAliasDecl, TYPE_FLAGS) };
  }

  const fnDecls = decls.filter(ts.isFunctionDeclaration);
  if (fnDecls.length > 0) {
    return {
      kind: 'function',
      signatures: fnDecls.map((fn) => serializeSignature(checker, fn)),
    };
  }

  const varDecl = decls.find(ts.isVariableDeclaration);
  if (varDecl) {
    const isConst = ts.isVariableDeclarationList(varDecl.parent)
      ? !!(varDecl.parent.flags & ts.NodeFlags.Const)
      : false;
    const type = checker.getTypeOfSymbolAtLocation(sym, varDecl);
    return {
      kind: isConst ? 'const' : 'let',
      type: checker.typeToString(type, varDecl, TYPE_FLAGS),
    };
  }

  return { kind: 'unknown', flags: sym.flags };
}

export function buildSnapshot() {
  if (!existsSync(ENTRY)) {
    throw new Error(`SDK entry not found: ${ENTRY}`);
  }
  const configFile = ts.readConfigFile(CONFIG_PATH, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Could not read ${CONFIG_PATH}: ${ts.flattenDiagnosticMessageText(
        configFile.error.messageText,
        '\n'
      )}`
    );
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(CONFIG_PATH));
  const program = ts.createProgram([ENTRY], {
    ...parsed.options,
    noEmit: true,
    declaration: false,
    declarationMap: false,
    isolatedModules: false,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(ENTRY);
  if (!sourceFile) {
    throw new Error(`Could not load SDK entry: ${ENTRY}`);
  }
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error('Could not resolve the SDK entry module symbol');
  }

  const exports = {};
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    exports[symbol.name] = serializeSymbol(checker, symbol, sourceFile);
  }

  return {
    version: 1,
    entry: relative(REPO_ROOT, ENTRY).split('\\').join('/'),
    exports: sortObject(exports),
  };
}

export function renderSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? resolve(args[outIdx + 1]) : SNAPSHOT_PATH;
  try {
    const snapshot = buildSnapshot();
    writeFileSync(outPath, renderSnapshot(snapshot), 'utf8');
    console.log(
      `Captured ${Object.keys(snapshot.exports).length} exports → ${relative(
        process.cwd(),
        outPath
      )}`
    );
  } catch (err) {
    console.error(`Failed to build SDK API snapshot: ${err.message}`);
    process.exit(1);
  }
}

export function readSnapshot(path = SNAPSHOT_PATH) {
  if (!existsSync(path)) {
    throw new Error(`API snapshot not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}
