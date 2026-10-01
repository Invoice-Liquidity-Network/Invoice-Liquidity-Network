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

function createTempProject(config: Record<string, unknown>): string {
  const cwd = path.join(os.tmpdir(), `iln-cli-config-${Date.now()}-${Math.random()}`);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(cwd, '.iln.json'), JSON.stringify(config, null, 2));
  tempRoots.push(cwd);
  return cwd;
}
