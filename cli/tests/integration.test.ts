import { Keypair } from '@stellar/stellar-sdk';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { beforeAll, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli';

const LOCAL_RPC_URL = process.env.ILN_CLI_LOCAL_RPC_URL ?? 'http://localhost:8000/soroban/rpc';
const LOCAL_CONTRACT_ID = process.env.ILN_CLI_LOCAL_CONTRACT_ID;
const LOCAL_TOKEN_ID = process.env.ILN_CLI_LOCAL_TOKEN_ID;
const FREELANCER_SECRET = process.env.ILN_CLI_LOCAL_FREELANCER_SECRET;
const PAYER_SECRET = process.env.ILN_CLI_LOCAL_PAYER_SECRET;
const FUNDER_SECRET = process.env.ILN_CLI_LOCAL_FUNDER_SECRET;
const hasLocalFixture =
  Boolean(LOCAL_CONTRACT_ID) &&
  Boolean(LOCAL_TOKEN_ID) &&
  Boolean(FREELANCER_SECRET) &&
  Boolean(PAYER_SECRET) &&
  Boolean(FUNDER_SECRET);

describe.skipIf(!hasLocalFixture)('CLI local integration', () => {
  const workdir = mkdtempSync(path.join(os.tmpdir(), 'iln-cli-local-'));
  const freelancerSecretPath = path.join(workdir, 'freelancer.secret');
  const payerSecretPath = path.join(workdir, 'payer.secret');
  const funderSecretPath = path.join(workdir, 'funder.secret');

  beforeAll(() => {
    writeFileSync(freelancerSecretPath, `${FREELANCER_SECRET!}\n`);
    writeFileSync(payerSecretPath, `${PAYER_SECRET!}\n`);
    writeFileSync(funderSecretPath, `${FUNDER_SECRET!}\n`);
  });

  it('covers submit, status, list, fund, and pay against a local Soroban instance', async () => {
    const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const due = dueDate.toISOString().slice(0, 10);
    const payerPublic = Keypair.fromSecret(PAYER_SECRET!).publicKey();
    const freelancerPublic = Keypair.fromSecret(FREELANCER_SECRET!).publicKey();
    const invoiceId = await submitInvoice(workdir, freelancerSecretPath, payerPublic, due);

    const statusBeforeFund = await invokeWithConfig(
      workdir,
      {
        contractId: LOCAL_CONTRACT_ID!,
        keypairPath: freelancerSecretPath,
        network: 'standalone',
        rpcUrl: LOCAL_RPC_URL,
        tokenId: LOCAL_TOKEN_ID!,
      },
      ['status', '--id', invoiceId.toString()]
    );
    expect(statusBeforeFund.stdout).toContain('Pending');

    const listResult = await invokeWithConfig(
      workdir,
      {
        contractId: LOCAL_CONTRACT_ID!,
        keypairPath: freelancerSecretPath,
        network: 'standalone',
        rpcUrl: LOCAL_RPC_URL,
        tokenId: LOCAL_TOKEN_ID!,
      },
      ['list', '--address', freelancerPublic]
    );
    expect(listResult.stdout).toContain(invoiceId.toString());

    const fundResult = await invokeWithConfig(
      workdir,
      {
        contractId: LOCAL_CONTRACT_ID!,
        keypairPath: funderSecretPath,
        network: 'standalone',
        rpcUrl: LOCAL_RPC_URL,
        tokenId: LOCAL_TOKEN_ID!,
      },
      ['fund', '--id', invoiceId.toString()]
    );
    expect(fundResult.stdout).toContain(`Funded invoice ${invoiceId.toString()}`);

    const payResult = await invokeWithConfig(
      workdir,
      {
        contractId: LOCAL_CONTRACT_ID!,
        keypairPath: payerSecretPath,
        network: 'standalone',
        rpcUrl: LOCAL_RPC_URL,
        tokenId: LOCAL_TOKEN_ID!,
      },
      ['pay', '--id', invoiceId.toString()]
    );
    expect(payResult.stdout).toContain(`Marked invoice ${invoiceId.toString()} as paid`);
  }, 180_000);
});

async function submitInvoice(
  cwd: string,
  keypairPath: string,
  payer: string,
  due: string
): Promise<number> {
  const result = await invokeWithConfig(
    cwd,
    {
      contractId: LOCAL_CONTRACT_ID!,
      keypairPath,
      network: 'standalone',
      rpcUrl: LOCAL_RPC_URL,
      tokenId: LOCAL_TOKEN_ID!,
    },
    ['submit', '--payer', payer, '--amount', '1', '--due', due, '--rate', '300']
  );

  const match = result.stdout.match(/Submitted invoice (\d+)/);
  if (!match) {
    throw new Error(`Could not extract invoice ID from output: ${result.stdout}`);
  }

  return Number(match[1]);
}

async function invokeWithConfig(
  cwd: string,
  config: Record<string, unknown>,
  argv: string[]
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  writeFileSync(path.join(cwd, '.iln.json'), JSON.stringify(config, null, 2));
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  const previous = process.cwd();

  process.chdir(cwd);
  try {
    const exitCode = await runCli(argv, { stdout, stderr });
    return {
      exitCode,
      stderr: stderr.toString(),
      stdout: stdout.toString(),
    };
  } finally {
    process.chdir(previous);
  }
}

function createMemoryStream(): Writable & { toString(): string } {
  let output = '';
  return Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    }),
    {
      toString() {
        return output;
      },
    }
  );
}
