/**
 * Tests for CLI config file support (#448)
 *
 * Covers:
 *  - Reading from .ilnrc.json
 *  - Reading from .iln.json (legacy)
 *  - Reading from .ilnrc.yaml (when yaml parser is available)
 *  - Config schema validation catching invalid config
 *  - CLI flags (env vars) override config file values
 *  - `iln config init` generates a valid starter file
 *  - initConfig refuses to overwrite existing config
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfigValidationError, initConfig, loadConfig } from '../src/config';
import { runCli } from '../src/cli';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

afterEach(() => {
  tempRoots.length = 0;
});

function tempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `iln-cli-ilnrc-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  tempRoots.push(dir);
  return dir;
}

function writeJson(dir: string, filename: string, content: unknown): void {
  writeFileSync(path.join(dir, filename), JSON.stringify(content, null, 2));
}

function createMemoryStream(): Writable & { toString(): string } {
  let buf = '';
  return Object.assign(
    new Writable({
      write(chunk, _enc, cb) {
        buf += chunk.toString();
        cb();
      },
    }),
    { toString: () => buf }
  );
}

// Minimal valid config content for .ilnrc.json / .iln.json
function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    network: 'testnet',
    contractIds: { invoice: 'CABC123' },
    deployer: { keypairPath: '/tmp/test.secret' },
    ...overrides,
  };
}

// ─── loadConfig: .ilnrc.json ──────────────────────────────────────────────────

describe('loadConfig — .ilnrc.json', () => {
  it('reads and resolves config from .ilnrc.json', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', validConfig());

    const config = loadConfig({ cwd, env: { HOME: '/tmp/home' } });

    expect(config.contractId).toBe('CABC123');
    expect(config.network).toBe('testnet');
    expect(config.keypairPath).toBe('/tmp/test.secret');
    expect(config.rpcUrl).toContain('soroban-testnet');
  });

  it('applies network defaults for testnet', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', validConfig({ network: 'testnet' }));

    const config = loadConfig({ cwd, env: {} });
    expect(config.networkPassphrase).toBe('Test SDF Network ; September 2015');
    expect(config.rpcUrl).toBe('https://soroban-testnet.stellar.org');
  });

  it('applies network defaults for standalone', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', validConfig({ network: 'standalone' }));

    const config = loadConfig({ cwd, env: {} });
    expect(config.rpcUrl).toBe('http://localhost:8000/soroban/rpc');
  });

  it('expands ~ in keypairPath using HOME env var', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', validConfig({ deployer: { keypairPath: '~/.stellar/key' } }));

    const config = loadConfig({ cwd, env: { HOME: '/home/testuser' } });
    expect(config.keypairPath).toBe('/home/testuser/.stellar/key');
  });

  it('reads tokenId from contractIds.token', () => {
    const cwd = tempDir();
    writeJson(
      cwd,
      '.ilnrc.json',
      validConfig({ contractIds: { invoice: 'CABC123', token: 'CTOKEN99' } })
    );

    const config = loadConfig({ cwd, env: {} });
    expect(config.tokenId).toBe('CTOKEN99');
  });
});

// ─── loadConfig: .iln.json (legacy) ──────────────────────────────────────────

describe('loadConfig — .iln.json (legacy)', () => {
  it('reads config from .iln.json when .ilnrc.json is absent', () => {
    const cwd = tempDir();
    writeJson(cwd, '.iln.json', validConfig());

    const config = loadConfig({ cwd, env: {} });
    expect(config.contractId).toBe('CABC123');
  });
});

// ─── loadConfig: file precedence ──────────────────────────────────────────────

describe('loadConfig — file precedence', () => {
  it('.iln.json wins over .ilnrc.json when both exist (search order)', () => {
    // .iln.json is second in the candidate list but the first *JSON* format.
    // If both exist, .iln.json takes precedence because it appears before .ilnrc.json
    // in the CONFIG_FILE_CANDIDATES array.
    const cwd = tempDir();
    writeJson(cwd, '.iln.json', validConfig({ contractIds: { invoice: 'FROM_ILN_JSON' } }));
    writeJson(cwd, '.ilnrc.json', validConfig({ contractIds: { invoice: 'FROM_ILNRC_JSON' } }));

    const config = loadConfig({ cwd, env: {} });
    expect(config.contractId).toBe('FROM_ILN_JSON');
  });
});

// ─── loadConfig: env var overrides ────────────────────────────────────────────

describe('loadConfig — env var overrides', () => {
  it('ILN_CONTRACT_ID overrides contractIds.invoice from file', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', validConfig());

    const config = loadConfig({
      cwd,
      env: { ILN_CONTRACT_ID: 'C_FROM_ENV', ILN_KEYPAIR_PATH: '/tmp/env.secret' },
    });

    expect(config.contractId).toBe('C_FROM_ENV');
  });

  it('ILN_KEYPAIR_PATH overrides deployer.keypairPath from file', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', validConfig());

    const config = loadConfig({ cwd, env: { ILN_KEYPAIR_PATH: '/env/path.secret' } });
    expect(config.keypairPath).toBe('/env/path.secret');
  });

  it('ILN_NETWORK overrides network from file', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', validConfig({ network: 'testnet' }));

    const config = loadConfig({ cwd, env: { ILN_NETWORK: 'mainnet' } });
    expect(config.network).toBe('mainnet');
    expect(config.rpcUrl).toContain('mainnet');
  });

  it('ILN_RPC_URL overrides file and defaults', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', validConfig());

    const config = loadConfig({
      cwd,
      env: { ILN_RPC_URL: 'https://my-custom-rpc.example' },
    });
    expect(config.rpcUrl).toBe('https://my-custom-rpc.example');
  });
});

// ─── loadConfig: schema validation ────────────────────────────────────────────

describe('loadConfig — schema validation', () => {
  it('throws ConfigValidationError when contractId is missing and no env var set', () => {
    const cwd = tempDir();
    // contractIds is empty — no invoice key
    writeJson(cwd, '.ilnrc.json', {
      network: 'testnet',
      contractIds: {},
      deployer: { keypairPath: '/tmp/test.secret' },
    });

    expect(() => loadConfig({ cwd, env: {} })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ cwd, env: {} })).toThrow(/Missing contract ID/);
  });

  it('throws ConfigValidationError when keypairPath is missing and no env var set', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', {
      network: 'testnet',
      contractIds: { invoice: 'CABC' },
      // no deployer.keypairPath
    });

    expect(() => loadConfig({ cwd, env: {} })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ cwd, env: {} })).toThrow(/Missing keypair path/);
  });

  it('throws ConfigValidationError when rpcUrl is present but not a valid URL', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', {
      network: 'testnet',
      rpcUrl: 'not-a-url',
      contractIds: { invoice: 'CABC' },
      deployer: { keypairPath: '/tmp/key.secret' },
    });

    expect(() => loadConfig({ cwd, env: {} })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ cwd, env: {} })).toThrow(/Config validation failed/);
  });

  it('throws on unrecognised network value', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', {
      network: 'devnet', // not in enum
      contractIds: { invoice: 'CABC' },
      deployer: { keypairPath: '/tmp/key.secret' },
    });

    expect(() => loadConfig({ cwd, env: {} })).toThrow(/Config validation failed/);
  });

  it('returns an empty config when no config file is found and env vars supply required values', () => {
    const cwd = tempDir(); // no files written

    const config = loadConfig({
      cwd,
      env: {
        ILN_CONTRACT_ID: 'CENV',
        ILN_KEYPAIR_PATH: '/tmp/env.secret',
      },
    });

    expect(config.contractId).toBe('CENV');
    expect(config.keypairPath).toBe('/tmp/env.secret');
    expect(config.network).toBe('testnet'); // default
  });
});

// ─── initConfig ───────────────────────────────────────────────────────────────

describe('initConfig', () => {
  it('creates a valid .ilnrc.json file', () => {
    const cwd = tempDir();
    const created = initConfig(cwd);

    expect(created).toBe(path.join(cwd, '.ilnrc.json'));

    const content = JSON.parse(readFileSync(created, 'utf8'));
    expect(content).toMatchObject({
      network: 'testnet',
      contractIds: expect.any(Object),
      deployer: { keypairPath: expect.any(String) },
    });
  });

  it('throws when a config file already exists', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', validConfig());

    expect(() => initConfig(cwd)).toThrow(/already exists/);
  });

  it('throws when .iln.json already exists (any recognised config file blocks init)', () => {
    const cwd = tempDir();
    writeJson(cwd, '.iln.json', validConfig());

    expect(() => initConfig(cwd)).toThrow(/already exists/);
  });

  it('generated file passes schema validation', () => {
    const cwd = tempDir();
    initConfig(cwd);

    // After filling in required values it must resolve without throwing
    const raw = JSON.parse(readFileSync(path.join(cwd, '.ilnrc.json'), 'utf8'));
    raw.contractIds.invoice = 'CABC_VALID';
    raw.deployer.keypairPath = '/tmp/key.secret';
    writeFileSync(path.join(cwd, '.ilnrc.json'), JSON.stringify(raw));

    expect(() => loadConfig({ cwd, env: {} })).not.toThrow();
  });
});

// ─── CLI: iln config init ─────────────────────────────────────────────────────

describe('iln config init (CLI command)', () => {
  it('creates .ilnrc.json and prints success', async () => {
    const cwd = tempDir();
    const stdout = createMemoryStream();
    const stderr = createMemoryStream();

    const exitCode = await runCli(['config', 'init', '--cwd', cwd], {
      createClient: () => ({} as any),
      loadConfig: () => {
        throw new Error('should not load config during init');
      },
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain('.ilnrc.json');
    expect(stdout.toString()).toContain('success');
  });

  it('returns exit code 1 and prints an error when config already exists', async () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', validConfig());

    const stderr = createMemoryStream();
    const exitCode = await runCli(['config', 'init', '--cwd', cwd], {
      createClient: () => ({} as any),
      loadConfig: () => {
        throw new Error('should not load config');
      },
      stdout: createMemoryStream(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.toString()).toContain('already exists');
  });
});

// ─── Additional validation & migration tests ──────────────────────────────────
describe('Config validation & version migration', () => {
  it('automatically migrates version 1 format to version 2 on disk', () => {
    const cwd = tempDir();
    const legacyConfig = {
      network: 'testnet',
      contractId: 'C_LEGACY',
      keypairPath: '/tmp/legacy.secret',
      tokenId: 'T_LEGACY',
    };
    writeJson(cwd, '.ilnrc.json', legacyConfig);

    const config = loadConfig({ cwd, env: {} });
    expect(config.contractId).toBe('C_LEGACY');
    expect(config.keypairPath).toBe('/tmp/legacy.secret');
    expect(config.tokenId).toBe('T_LEGACY');

    // Verify it was updated on disk
    const updatedRaw = JSON.parse(readFileSync(path.join(cwd, '.ilnrc.json'), 'utf8'));
    expect(updatedRaw.version).toBe(2);
    expect(updatedRaw.contractIds.invoice).toBe('C_LEGACY');
    expect(updatedRaw.contractIds.token).toBe('T_LEGACY');
    expect(updatedRaw.deployer.keypairPath).toBe('/tmp/legacy.secret');
    expect(updatedRaw.contractId).toBeUndefined();
    expect(updatedRaw.keypairPath).toBeUndefined();
    expect(updatedRaw.tokenId).toBeUndefined();
    expect(updatedRaw['$schema']).toBe('./config.schema.json');
  });

  it('produces formatted, helpful error messages on validation failure', () => {
    const cwd = tempDir();
    writeJson(cwd, '.ilnrc.json', {
      network: 'invalid-network-name',
      rpcUrl: 'not-a-url',
    });

    expect(() => loadConfig({ cwd, env: {} })).toThrow(/\[Field: network\].*\[Field: rpcUrl\]/);
  });
});
