import "dotenv/config";
import { ILNSdk, ILN_TESTNET, createKeypairSigner } from "@iln/sdk";
import { Keypair, Networks } from "@stellar/stellar-sdk";

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry function with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
  delayMs: number = RETRY_DELAY_MS
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 1) {
      throw error;
    }
    console.log(`Retrying in ${delayMs}ms... (${retries - 1} attempts left)`);
    await sleep(delayMs);
    return withRetry(fn, retries - 1, delayMs * 2);
  }
}

// Validate environment variables
function validateEnv() {
  const required = [
    "FREELANCER_SECRET_KEY",
    "PAYER_ADDRESS",
    "INVOICE_AMOUNT",
    "INVOICE_DUE_DATE",
    "INVOICE_DISCOUNT_RATE"
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  // Validate keypair
  try {
    Keypair.fromSecret(process.env.FREELANCER_SECRET_KEY!);
  } catch {
    throw new Error("Invalid FREELANCER_SECRET_KEY: not a valid Stellar secret key");
  }

  // Validate invoice amount
  const amount = BigInt(process.env.INVOICE_AMOUNT!);
  if (amount <= 0) {
    throw new Error("INVOICE_AMOUNT must be a positive number");
  }

  // Validate due date
  const dueDate = Number(process.env.INVOICE_DUE_DATE!);
  if (isNaN(dueDate) || dueDate <= Math.floor(Date.now() / 1000)) {
    throw new Error("INVOICE_DUE_DATE must be a valid future Unix timestamp (in seconds)");
  }

  // Validate discount rate
  const discountRate = Number(process.env.INVOICE_DISCOUNT_RATE!);
  if (isNaN(discountRate) || discountRate < 0 || discountRate > 100) {
    throw new Error("INVOICE_DISCOUNT_RATE must be a number between 0 and 100");
  }

  return {
    freelancerSecretKey: process.env.FREELANCER_SECRET_KEY!,
    payerAddress: process.env.PAYER_ADDRESS!,
    amount: amount,
    dueDate: dueDate,
    discountRate: discountRate,
    contractId: process.env.CONTRACT_ID || ILN_TESTNET.contractId,
    rpcUrl: process.env.RPC_URL || ILN_TESTNET.rpcUrl,
    networkPassphrase: process.env.NETWORK_PASSPHRASE || ILN_TESTNET.networkPassphrase
  };
}

async function main() {
  console.log("=== Invoice Submission Script ===");

  // Load and validate configuration
  const config = validateEnv();
  const freelancerKeypair = Keypair.fromSecret(config.freelancerSecretKey);
  const freelancerAddress = freelancerKeypair.publicKey();

  console.log("\nConfiguration:");
  console.log(`- Freelancer address: ${freelancerAddress}`);
  console.log(`- Payer address: ${config.payerAddress}`);
  console.log(`- Amount: ${config.amount} stroops`);
  console.log(`- Due date: ${new Date(config.dueDate * 1000).toISOString()}`);
  console.log(`- Discount rate: ${config.discountRate}%`);
  console.log(`- Contract ID: ${config.contractId}`);
  console.log(`- Network: ${config.networkPassphrase === Networks.TESTNET ? "Testnet" : "Custom"}\n`);

  // Create signer and SDK instance
  const signer = createKeypairSigner(config.freelancerSecretKey);
  const sdk = new ILNSdk({
    contractId: config.contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    signer
  });

  // Build invoice parameters
  const invoiceParams = {
    freelancer: freelancerAddress,
    payer: config.payerAddress,
    amount: config.amount,
    dueDate: config.dueDate,
    discountRate: config.discountRate
  };

  console.log("Submitting invoice...");

  try {
    // Submit invoice with retry for network errors
    const invoiceId = await withRetry(async () => {
      return await sdk.submitInvoice(invoiceParams);
    });

    console.log("\n✅ Invoice submitted successfully!");
    console.log(`📋 Invoice ID: ${invoiceId}`);
    console.log(`🔗 Check on Stellar Explorer: https://stellar.expert/explorer/testnet/contract/${config.contractId}`);

    // Optional: Verify the invoice was created
    console.log("\nVerifying invoice...");
    const invoice = await sdk.getInvoice(invoiceId);
    console.log("Invoice details:");
    console.log(invoice);
  } catch (error: any) {
    console.error("\n❌ Error submitting invoice:");

    // Handle specific errors
    if (error.message?.includes("budget") || error.message?.includes("BudgetExceeded")) {
      console.error("  - Soroban simulation failed: Budget exceeded");
    } else if (error.message?.includes("insufficient") || error.message?.includes("balance")) {
      console.error("  - Insufficient balance in the freelancer account");
    } else if (error.message?.includes("network") || error.message?.includes("connection")) {
      console.error("  - Network error (retried multiple times)");
    } else {
      console.error(`  - ${error.message}`);
    }

    console.error("\nFull error details:", error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
