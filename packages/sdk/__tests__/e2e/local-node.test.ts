import { describe, it, expect } from 'vitest';
import { Keypair, Server, TransactionBuilder, Operation, BASE_FEE, Networks } from '@stellar/stellar-sdk';

const FRIENDBOT = 'http://localhost:8000/friendbot';
const HORIZON = 'http://localhost:8000';

describe('SDK e2e against local Stellar node', () => {
  it('can talk to local Horizon and perform a simple payment', async () => {
    const server = new Server(HORIZON);

    // Create two accounts
    const kpA = Keypair.random();
    const kpB = Keypair.random();

    // Fund both via friendbot
    const fundA = await fetch(`${FRIENDBOT}?addr=${kpA.publicKey()}`);
    expect(fundA.ok).toBeTruthy();
    const fundB = await fetch(`${FRIENDBOT}?addr=${kpB.publicKey()}`);
    expect(fundB.ok).toBeTruthy();

    // Load account A
    const accountA = await server.loadAccount(kpA.publicKey());

    // Build and sign a payment from A -> B
    const tx = new TransactionBuilder(accountA, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({
        destination: kpB.publicKey(),
        asset: undefined as any,
        amount: '1',
      }))
      .setTimeout(30)
      .build();

    tx.sign(kpA);

    const res = await server.submitTransaction(tx);
    expect(res.hash).toBeTruthy();
    expect(res.successful).toBeTruthy();
  }, 60_000);
});
