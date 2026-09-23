// JavaScript (CommonJS) example for the ILN SDK
// Demonstrates submitting an invoice, funding it, and checking status

const { ILNSdk, ILN_TESTNET, createKeypairSigner } = require('@iln/sdk');
const { Keypair } = require('@stellar/stellar-sdk');
require('dotenv').config();

async function main() {
  console.log('=== ILN SDK — JavaScript CommonJS Example ===\n');

  // ── Configuration ───────────────────────────────────────────────────────
  const secretKey = process.env.SECRET_KEY;
  const payerAddress = process.env.PAYER_ADDRESS;

  if (!secretKey) {
    console.error('Missing SECRET_KEY environment variable');
    console.error('Copy .env.example to .env and fill in your credentials');
    process.exit(1);
  }

  if (!payerAddress) {
    console.error('Missing PAYER_ADDRESS environment variable');
    process.exit(1);
  }

  // ── Initialize SDK ─────────────────────────────────────────────────────
  const keypair = Keypair.fromSecret(secretKey);
  const freelancerAddress = keypair.publicKey();

  const sdk = new ILNSdk({
    ...ILN_TESTNET,
    signer: createKeypairSigner(secretKey),
  });

  console.log(`Freelancer: ${freelancerAddress}`);
  console.log(`Payer:      ${payerAddress}`);
  console.log();

  // ── Check Protocol Config ───────────────────────────────────────────────
  console.log('Fetching protocol configuration...');
  const config = await sdk.getProtocolConfig();
  console.log(`  Min invoice amount:  ${config.minInvoiceAmount}`);
  console.log(`  Max discount rate:   ${config.maxDiscountRate} bps`);
  console.log(`  Protocol fee:        ${config.protocolFeeBps} bps`);
  console.log();

  // ── Submit Invoice ──────────────────────────────────────────────────────
  const dueDate = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days from now

  console.log('Submitting invoice...');
  const invoiceId = await sdk.submitInvoice({
    freelancer: freelancerAddress,
    payer: payerAddress,
    amount: 10000000n, // 1 USDC (6 decimals)
    dueDate,
    discountRate: 500, // 5%
  });

  console.log(`  Invoice ID: ${invoiceId}`);
  console.log();

  // ── Get Invoice Details ─────────────────────────────────────────────────
  console.log('Fetching invoice details...');
  const invoice = await sdk.getInvoice(invoiceId);
  console.log(`  Status:    ${invoice.status}`);
  console.log(`  Amount:    ${invoice.amount}`);
  console.log(`  Discount:  ${invoice.discountRate} bps`);
  console.log(`  Due date:  ${new Date(invoice.dueDate * 1000).toISOString()}`);
  console.log();

  // ── Check Reputation ────────────────────────────────────────────────────
  console.log('Checking freelancer reputation...');
  const reputation = await sdk.getReputation(freelancerAddress);
  console.log(`  Reputation score: ${reputation}`);
  console.log();

  console.log('Example complete!');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
