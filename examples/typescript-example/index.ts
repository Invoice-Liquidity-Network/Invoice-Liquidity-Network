// TypeScript example for the ILN SDK
// Demonstrates type-safe usage of all major SDK features

import 'dotenv/config';
import {
  ILNSdk,
  ILN_TESTNET,
  createKeypairSigner,
  type Invoice,
  type ProtocolConfig,
  type BatchResult,
} from '@iln/sdk';
import { Keypair, Networks } from '@stellar/stellar-sdk';

// ── Types ────────────────────────────────────────────────────────────────────

interface AppConfig {
  freelancerSecretKey: string;
  payerAddress: string;
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadConfig(): AppConfig {
  const secretKey = process.env.SECRET_KEY;
  const payerAddress = process.env.PAYER_ADDRESS;

  if (!secretKey) throw new Error('Missing SECRET_KEY');
  if (!payerAddress) throw new Error('Missing PAYER_ADDRESS');

  // Validate keypair
  Keypair.fromSecret(secretKey);

  return {
    freelancerSecretKey: secretKey,
    payerAddress,
    contractId: process.env.CONTRACT_ID || ILN_TESTNET.contractId,
    rpcUrl: process.env.RPC_URL || ILN_TESTNET.rpcUrl,
    networkPassphrase: process.env.NETWORK_PASSPHRASE || ILN_TESTNET.networkPassphrase,
  };
}

function formatAmount(amount: bigint): string {
  const major = Number(amount) / 10_000_000;
  return `${major.toFixed(2)} USDC`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== ILN SDK — TypeScript Example ===\n');

  const config = loadConfig();
  const keypair = Keypair.fromSecret(config.freelancerSecretKey);
  const freelancerAddress = keypair.publicKey();

  // Initialize SDK with full type safety
  const sdk = new ILNSdk({
    contractId: config.contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    signer: createKeypairSigner(config.freelancerSecretKey),
  });

  console.log(`Network: ${config.networkPassphrase === Networks.TESTNET ? 'Testnet' : 'Mainnet'}`);
  console.log(`Freelancer: ${freelancerAddress}`);
  console.log(`Payer: ${config.payerAddress}\n`);

  // ── 1. Protocol Configuration ──────────────────────────────────────────
  console.log('1. Protocol Configuration');
  const protocolConfig: ProtocolConfig = await sdk.getProtocolConfig();
  console.log(`   Min amount:     ${protocolConfig.minInvoiceAmount}`);
  console.log(`   Max discount:   ${protocolConfig.maxDiscountRate} bps`);
  console.log(`   Protocol fee:   ${protocolConfig.protocolFeeBps} bps`);
  console.log(`   Min reputation: ${protocolConfig.minPayerReputation}\n`);

  // ── 2. Compatibility Check ─────────────────────────────────────────────
  console.log('2. Compatibility Check');
  const compat = await sdk.checkCompatibility();
  console.log(`   SDK version:    ${compat.sdkVersion}`);
  console.log(`   Contract:       ${compat.contractVersion}`);
  console.log(`   Compatible:     ${compat.compatible}\n`);

  // ── 3. Submit Invoice ──────────────────────────────────────────────────
  console.log('3. Submitting Invoice');
  const dueDate = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  const invoiceId: bigint = await sdk.submitInvoice({
    freelancer: freelancerAddress,
    payer: config.payerAddress,
    amount: 10_000_000n,
    dueDate,
    discountRate: 500,
  });
  console.log(`   Invoice ID: ${invoiceId}\n`);

  // ── 4. Query Invoice ───────────────────────────────────────────────────
  console.log('4. Invoice Details');
  const invoice: Invoice = await sdk.getInvoice(invoiceId);
  console.log(`   Status:      ${invoice.status}`);
  console.log(`   Amount:      ${formatAmount(invoice.amount)}`);
  console.log(`   Discount:    ${invoice.discountRate} bps`);
  console.log(`   Due:         ${new Date(invoice.dueDate * 1000).toLocaleDateString()}\n`);

  // ── 5. Reputation ──────────────────────────────────────────────────────
  console.log('5. Reputation Score');
  const reputation: number = await sdk.getReputation(freelancerAddress);
  console.log(`   Score: ${reputation}\n`);

  // ── 6. Protocol Stats ──────────────────────────────────────────────────
  console.log('6. Protocol Stats');
  const stats = await sdk.getStats();
  console.log(`   Stats:`, stats);
  console.log();

  console.log('TypeScript example complete!');
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
