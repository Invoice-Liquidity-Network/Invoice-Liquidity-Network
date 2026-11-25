import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';

const tempRoots: string[] = [];

afterEach(() => {
  tempRoots.length = 0;
});

describe('loadConfig', () => {
  it('reads .iln.json and applies network defaults', () => {
    const cwd = createTempProject({
      contractId: 'CABC',
      keypairPath: '~/.stellar/iln.secret',
      network: 'standalone',
      tokenId: 'CTOKEN',
    });

    const config = loadConfig({
      cwd,
      env: { HOME: '/tmp/home' },
    });

    expect(config.contractId).toBe('CABC');
    expect(config.keypairPath).toBe(path.join('/tmp/home', '.stellar/iln.secret'));
    expect(config.network).toBe('standalone');
    expect(config.rpcUrl).toBe('http://localhost:8000/soroban/rpc');
    expect(config.tokenId).toBe('CTOKEN');
  });

  it('lets environment variables override file values', () => {
    const cwd = createTempProject({
      contractId: 'CFILE',
      keypairPath: '/tmp/file.secret',
      network: 'testnet',
    });

    const config = loadConfig({
      cwd,
      env: {
        ILN_CONTRACT_ID: 'CENV',
        ILN_KEYPAIR_PATH: '/tmp/env.secret',
        ILN_NETWORK: 'mainnet',
        ILN_RPC_URL: 'https://custom-rpc.example',
      },
    });

    expect(config.contractId).toBe('CENV');
    expect(config.keypairPath).toBe('/tmp/env.secret');
    expect(config.network).toBe('mainnet');
    expect(config.rpcUrl).toBe('https://custom-rpc.example');
  });

  it('fails with a clear message when required config is missing', () => {
    const cwd = createTempProject({ network: 'testnet' });

    expect(() => loadConfig({ cwd, env: {} })).toThrow(/Missing contract ID/);
  });
});

describe('loadConfig fails closed on contradictory network config (#1490)', () => {
  const base = { contractId: 'CABC', keypairPath: '/tmp/k.secret' };
  const TESTNET = 'Test SDF Network ; September 2015';
  const PUBLIC = 'Public Global Stellar Network ; September 2015';

  it('accepts a passphrase that matches the selected network', () => {
    const cwd = createTempProject({ ...base, network: 'mainnet' });

    const config = loadConfig({ cwd, env: { ILN_NETWORK_PASSPHRASE: PUBLIC } });

    expect(config.networkPassphrase).toBe(PUBLIC);
    expect(config.rpcUrl).toMatch(/^https:/);
  });

  it('rejects a testnet passphrase on mainnet', () => {
    const cwd = createTempProject({ ...base, network: 'mainnet' });

    expect(() => loadConfig({ cwd, env: { ILN_NETWORK_PASSPHRASE: TESTNET } })).toThrow(
      /passphrase does not match network "mainnet"/
    );
  });

  it('rejects a mainnet passphrase when ILN_NETWORK switches to testnet', () => {
    const cwd = createTempProject({ ...base, network: 'mainnet' });

    expect(() =>
      loadConfig({ cwd, env: { ILN_NETWORK: 'testnet', ILN_NETWORK_PASSPHRASE: PUBLIC } })
    ).toThrow(/passphrase does not match network "testnet"/);
  });

  it('still allows a custom passphrase on standalone', () => {
    const cwd = createTempProject({ ...base, network: 'standalone' });

    const config = loadConfig({ cwd, env: { ILN_NETWORK_PASSPHRASE: 'My Local Net' } });

    expect(config.networkPassphrase).toBe('My Local Net');
  });

  it.each(['not a url', 'ftp://rpc.example', 'file:///etc/passwd'])(
    'rejects ILN_RPC_URL=%s',
    (rpcUrl) => {
      const cwd = createTempProject({ ...base, network: 'testnet' });

      expect(() => loadConfig({ cwd, env: { ILN_RPC_URL: rpcUrl } })).toThrow(/RPC URL/);
    }
  );

  it('rejects plain-HTTP RPC on mainnet but allows it on standalone', () => {
    const mainnet = createTempProject({ ...base, network: 'mainnet' });
    expect(() => loadConfig({ cwd: mainnet, env: { ILN_RPC_URL: 'http://rpc.example' } })).toThrow(
      /must use https/
    );

    const standalone = createTempProject({ ...base, network: 'standalone' });
    expect(loadConfig({ cwd: standalone, env: {} }).rpcUrl).toMatch(/^http:/);
  });

  it('reports an unsupported ILN_NETWORK as a config validation error', () => {
    const cwd = createTempProject(base);

    expect(() => loadConfig({ cwd, env: { ILN_NETWORK: 'futurenet' } })).toThrow(
      expect.objectContaining({ name: 'ConfigValidationError' })
    );
  });
});

function createTempProject(config: Record<string, unknown>): string {
  const cwd = path.join(os.tmpdir(), `iln-cli-config-${Date.now()}-${Math.random()}`);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(cwd, '.iln.json'), JSON.stringify(config, null, 2));
  tempRoots.push(cwd);
  return cwd;
}
