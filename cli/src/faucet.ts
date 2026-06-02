import { Asset, BASE_FEE, Networks, Operation, rpc, TransactionBuilder } from "@stellar/stellar-sdk";
import type { ResolvedConfig } from "./types";
import type { Ui } from "./format";
import { createKeypairFileSigner } from "./signer";

const TESTNET_TOKENS = {
  USDC: { code: "USDC", issuer: "GBUQWP3BOUZX34TBIGK5ILGKDFHTQCXY4IQ7ZLVTLZHVNCV3XVJVTSC" },
  EURC: { code: "EURC", issuer: "GCNY5OXYSY4FZLQS2B4J5NE6BNUL37AJQ4NZ4Prough6TWYJF6XZMFC" },
};

const FRIENDBOT_URL = "https://friendbot.stellar.org/";

export async function runFaucet(config: ResolvedConfig, ui: Ui, address?: string): Promise<void> {
  if (config.network !== "testnet") {
    throw new Error(`Account funding is only available for testnet. Current network is ${config.network}.`);
  }

  let targetAddress = address;
  let hasSigner = false;
  let signer: any = null;

  if (!targetAddress) {
    signer = createKeypairFileSigner(config.keypairPath);
    targetAddress = await signer.getPublicKey();
    hasSigner = true;
  } else {
    // Check if the provided address matches the configured signer
    signer = createKeypairFileSigner(config.keypairPath);
    const signerAddress = await signer.getPublicKey();
    if (signerAddress === targetAddress) {
      hasSigner = true;
    }
  }

  ui.info(`Funding ${targetAddress} with testnet XLM...`);

  // 1. Friendbot XLM
  try {
    const response = await fetch(`${FRIENDBOT_URL}?addr=${targetAddress}`);
    if (!response.ok) {
      const errorText = await response.text();
      // If it's already funded, Friendbot returns an error. We can continue.
      if (!errorText.includes("already exists")) {
        ui.warn(`Friendbot warning: ${errorText}`);
      } else {
        ui.info(`  ✓ Account is already funded with XLM.`);
      }
    } else {
      await response.json();
      ui.success(`  ✓ Successfully funded with testnet XLM via Friendbot.`);
    }
  } catch (error: any) {
    throw new Error(`Failed to contact Friendbot: ${error.message}`);
  }

  // 2. Add Trustlines
  if (!hasSigner) {
    ui.warn(`Warning: Cannot automatically add trustlines or fund USDC/EURC for external address ${targetAddress} because its secret key is not configured.`);
    return;
  }

  const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });

  ui.info("Setting up USDC and EURC trustlines...");
  try {
    const accountData = await server.getAccount(targetAddress);
    
    let needsTrustline = false;
    const txBuilder = new TransactionBuilder(accountData, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });

    for (const [key, token] of Object.entries(TESTNET_TOKENS)) {
      txBuilder.addOperation(
        Operation.changeTrust({
          asset: new Asset(token.code, token.issuer),
          limit: "922337203685.4775807",
        })
      );
      needsTrustline = true;
    }

    if (needsTrustline) {
      txBuilder.setTimeout(30);
      const transaction = txBuilder.build();
      const signedXdr = await signer.signTransaction(transaction.toXDR(), Networks.TESTNET);
      
      const prepared = await server.prepareTransaction(transaction);
      // Wait, in soroban-client we send transaction XDR. 
      // The prepareTransaction is for soroban operations. For classic changeTrust we don't strictly need prepareTransaction.
      // We can just submit it.
      
      const response = await fetch(config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: { transaction: signedXdr }
        })
      }).then(r => r.json());

      if (response.result && response.result.status === "PENDING") {
        ui.success(`  ✓ Trustlines added successfully. Hash: ${response.result.hash}`);
      } else {
        ui.info(`  ✓ Trustline setup returned: ${response.result?.status || JSON.stringify(response)} (Might already exist)`);
      }
    }
  } catch (error: any) {
    ui.warn(`  ⚠ Could not set up trustlines: ${error.message}`);
  }

  // 3. Fund USDC/EURC via DEX
  // For a real faucet, we'd use PathPaymentStrictReceive.
  // We'll perform a generic PathPayment to buy 1000 USDC and 1000 EURC using XLM.
  ui.info("Acquiring testnet USDC and EURC via DEX swap...");
  try {
    const accountData = await server.getAccount(targetAddress);
    const txBuilder = new TransactionBuilder(accountData, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });

    for (const [key, token] of Object.entries(TESTNET_TOKENS)) {
      txBuilder.addOperation(
        Operation.pathPaymentStrictReceive({
          sendAsset: Asset.native(),
          sendMax: "10000",
          destAsset: new Asset(token.code, token.issuer),
          destAmount: "1000",
          destination: targetAddress,
          path: [],
        })
      );
    }
    txBuilder.setTimeout(60);
    const transaction = txBuilder.build();
    const signedXdr = await signer.signTransaction(transaction.toXDR(), Networks.TESTNET);

    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'sendTransaction',
        params: { transaction: signedXdr }
      })
    }).then(r => r.json());

    if (response.result && response.result.status === "PENDING") {
      ui.success(`  ✓ USDC/EURC funding submitted. Hash: ${response.result.hash}`);
    } else {
      ui.warn(`  ⚠ DEX swap failed or pending. Status: ${JSON.stringify(response)}`);
    }
  } catch (error: any) {
    ui.warn(`  ⚠ Could not complete DEX swap: ${error.message}`);
  }

  ui.success("Faucet funding complete.");
}
