# DeFi Integration Guide

This guide explores how Invoice Liquidity Network (ILN) can compose with Stellar DeFi primitives without turning ILN itself into a full trading venue or lending protocol. The core idea is simple: ILN can stay focused on invoice financing while letting users route value through Stellar's native order books, liquidity pools, and ecosystem incentive layers.

## What this guide covers

- Trading ILN-linked positions on Stellar's native DEX
- Swapping stablecoins through Stellar AMMs and path payments
- Composing with Aquarius (AQUA) rewards and liquidity incentives
- Using invoice NFTs as collateral in Stellar-based lending protocols

## Quick feasibility summary

| Integration | Current feasibility | Required protocol changes | Best fit for ILN |
|---|---|---|---|
| LP positions traded via Stellar DEX offers | Feasible today if positions are represented as transferable assets or wrapped claims | No core protocol change; ILN needs a clear token/wrap/redemption model | Secondary market for LP exits |
| Stablecoin swaps via Stellar AMMs | Feasible today through path payments and liquidity pools | Usually none; add routing, slippage, and quote discovery | Treasury rebalancing, payout conversion, fee routing |
| Aquarius yield opportunities | Feasible today for eligible markets and pools | Usually none; add trustlines, reward tracking, and UX integration | Incentivized liquidity and market making |
| Invoice NFTs as lending collateral | Partially feasible today through wrappers and adapters | Requires collateral valuation, oracle support, liquidation rules, and lending adapter contracts | Experimental credit products |

---

## 1. Trading LP Positions via Stellar DEX Offers

### What this means

If ILN wraps an LP position into a transferable claim token, that claim can be listed on the Stellar DEX like any other asset pair. In practice, this lets an LP exit early by selling the position to another market participant.

Stellar's native DEX uses order books, while liquidity pools provide AMM routing. A position token does not need any special protocol support beyond being a valid Stellar asset with a trustline and a redemption rule.

### Current feasibility

**Feasible today, with a design caveat.**

Stellar already supports order book trading through `ManageBuyOffer` and `ManageSellOffer`. The part ILN must define is how the LP position is represented:

- Native pool shares themselves are not transferable.
- If ILN wants a secondary market, it needs a wrapper token, voucher, or claim certificate that redeems into the underlying position.

### Required protocol changes

- No Stellar protocol changes.
- ILN should define:
  - a canonical asset or wrapper for the LP position
  - redemption mechanics back into the underlying invoice claim
  - valuation rules so buyers know what they are purchasing
  - disclosure around maturity, default risk, and settlement delays

### Example code

```ts
import {
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Server,
} from "@stellar/stellar-sdk";

const server = new Server("https://horizon-testnet.stellar.org");

const lpShare = new Asset("ILNLP", "G...LP_SHARE_ISSUER");
const usdc = new Asset("USDC", "G...USDC_ISSUER");

export async function listLpPositionForSale(sellerSecret: string) {
  const seller = Keypair.fromSecret(sellerSecret);
  const account = await server.loadAccount(seller.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.manageSellOffer({
        selling: lpShare,
        buying: usdc,
        amount: "100",
        price: "1.05",
        offerId: "0",
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(seller);
  return server.submitTransaction(tx);
}
```

### Practical note

This design is best for an ILN LP position that behaves like a claim token. If the position is meant to remain non-transferable, then the better integration is not DEX trading itself, but a wrapped exit product that converts the position into a transferable asset.

---

## 2. Stablecoin Swaps with Stellar AMMs

### What this means

ILN can use Stellar's liquidity pools to convert between stablecoins or route payments through the best available path. This is especially useful if the protocol needs to:

- convert treasury balances into the invoice currency
- rebalance reserves across multiple stablecoins
- pay freelancers in one asset while receiving settlement in another

Stellar path payments can traverse both the native DEX and liquidity pools, so an app does not need to manually choose one venue or the other if a valid route exists.

### Current feasibility

**Feasible today.**

The Stellar docs describe path payments as using offers and/or liquidity pools, and liquidity pools are already part of the protocol. For ILN, this means a stablecoin swap can be implemented with standard Stellar transactions.

### Required protocol changes

- No core protocol change.
- ILN should add:
  - quote discovery before submission
  - slippage limits
  - route fallback logic
  - a policy for which assets may be used for settlement

### Example code

```ts
import {
  Asset,
  Keypair,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  Networks,
  Operation,
  Server,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const server = new Server("https://horizon-testnet.stellar.org");

const usdc = new Asset("USDC", "G...USDC_ISSUER");
const eurc = new Asset("EURC", "G...EURC_ISSUER");

export async function swapStablecoins(
  sourceSecret: string,
  destinationPublicKey: string,
) {
  const source = Keypair.fromSecret(sourceSecret);
  const account = await server.loadAccount(source.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: usdc,
        sendMax: "1000000",
        destAsset: eurc,
        destAmount: "990000",
        destination: destinationPublicKey,
        path: [],
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(source);
  return server.submitTransaction(tx);
}
```

### Practical note

For ILN, the cleanest pattern is to treat AMM routing as an internal treasury or payout utility, not as a user-facing trading abstraction. That keeps invoice logic separate from market logic while still benefiting from Stellar liquidity.

---

## 3. Composing with Aquarius Yield Opportunities

### What this means

Aquarius provides incentive layers for both Stellar's native DEX and its AMM ecosystem. That makes it useful for ILN treasury management, idle capital routing, and liquidity provider incentives.

In the current Aquarius model, rewards are associated with eligible SDEX markets and AMM pools. That means ILN can place capital where it improves market depth and also earns reward flow on top of the underlying trading fees.

### Current feasibility

**Feasible today.**

Aquarius' own docs describe rewards for AMM LPs and SDEX market makers. For ILN, that makes Aquarius an adjacent yield layer rather than a protocol dependency.

### Required protocol changes

- No Stellar protocol change.
- Minimal ILN change:
  - add AQUA trustline support where needed
  - support reward tracking in dashboards
  - surface incentive-eligible pools or markets
  - optionally allow a treasury policy to target reward-bearing liquidity

### Example code

```ts
import {
  Asset,
  Keypair,
  LiquidityPoolAsset,
  Networks,
  Operation,
  Server,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const server = new Server("https://horizon-testnet.stellar.org");

const aqua = new Asset("AQUA", "G...AQUA_ISSUER");
const usdc = new Asset("USDC", "G...USDC_ISSUER");
const xlm = Asset.native();
const poolAsset = new LiquidityPoolAsset(usdc, xlm, LiquidityPoolFeeV18);
const poolId = "POOL_ID_HEX"; // derive from the pool parameters before submitting

export async function addLiquidityForRewardMarkets(
  sourceSecret: string,
) {
  const source = Keypair.fromSecret(sourceSecret);
  const account = await server.loadAccount(source.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: "200",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: aqua }))
    .addOperation(Operation.changeTrust({ asset: poolAsset }))
    .addOperation(
      Operation.liquidityPoolDeposit({
        liquidityPoolId: poolId,
        maxAmountA: "5000000",
        maxAmountB: "5000000",
        minPrice: "0.95",
        maxPrice: "1.05",
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(source);
  return server.submitTransaction(tx);
}
```

### Practical note

Aquarius is a yield layer on top of Stellar liquidity, not a substitute for ILN's own risk controls. If ILN allocates capital into incentive markets, it should still enforce treasury limits, exit thresholds, and asset allowlists.

---

## 4. Invoice NFTs as Collateral in Lending Protocols

### What this means

Invoice NFTs can become useful collateral if a lending protocol is willing to accept them as a borrowable asset class. The most realistic path is not a direct NFT-to-loan flow inside ILN, but a wrapper that:

- escrows the invoice NFT
- prices the invoice using an oracle or risk model
- issues a collateral position to a lending market
- liquidates the NFT or its claim if the borrower defaults

On Stellar, that means ILN would compose with a lending protocol rather than replace one.

### Current feasibility

**Partially feasible today.**

The protocol building blocks exist, but the full flow is not native:

- the NFT must be transferable or escrowable
- the lending market must accept it as collateral, either directly or through an adapter
- the protocol needs a liquidation path and an objective valuation model

### Required protocol changes

- No Stellar core change.
- ILN would need additional application-layer components:
  - an NFT escrow or wrapper contract
  - a valuation oracle or underwriting model
  - liquidation and recovery rules
  - a lending adapter for the target protocol

### Example code

The exact implementation depends on the lending protocol, but the shape is usually:

```rust
// Pseudocode for a Soroban adapter contract
// 1. Receive the invoice NFT into escrow
// 2. Verify the invoice metadata and maturity
// 3. Check an oracle / risk score for the borrower
// 4. Mark the NFT as collateralized
// 5. Forward the approved collateral position to a lending market

pub fn deposit_invoice_nft_as_collateral(
    env: Env,
    borrower: Address,
    invoice_id: BytesN<32>,
    loan_market: Address,
) {
    // Transfer the invoice NFT into escrow
    // assert ownership and maturity constraints
    // register the collateral value
    // call into the lending market adapter
}
```

### Practical note

This is the most experimental integration in the guide. The main risk is not blockchain compatibility, but undercollateralization and liquidation complexity. If ILN explores this path, it should start with a narrow pilot and a conservative collateral haircut.

---

## How ILN Fits the Broader Stellar DeFi Stack

ILN is well positioned as a real-world credit primitive inside Stellar's composable finance stack:

- Stellar's DEX and liquidity pools provide routing and market depth
- Aquarius adds incentive layers for liquidity and order book activity
- Lending protocols such as Blend provide a natural venue for collateralized credit experiments
- ILN contributes invoice cash flows, repayment dates, and credit-style underwriting signals

That combination makes ILN more than an isolated invoice marketplace. It becomes a component that can feed liquidity, collateral, and yield into the wider Stellar ecosystem while keeping invoice financing as the source of truth.

## Recommended implementation path

1. Start with stablecoin routing through Stellar path payments and AMMs.
2. Add Aquarius-aware treasury and LP dashboards.
3. Define a transferable LP position format if a secondary market is desired.
4. Treat invoice NFT collateral as an experimental adapter, not a default feature.

## References

- [Liquidity on Stellar: SDEX & Liquidity Pools](https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools)
- [Path Payments](https://developers.stellar.org/docs/build/guides/transactions/path-payments)
- [Stellar CLI: Liquidity Pool Deposit](https://developers.stellar.org/docs/tools/cli/stellar-cli)
- [Aquarius Guide](https://docs.aqua.network/)
- [Aquarius Rewards](https://aqua.network/rewards/)
- [Stellar DeFi Composability](https://stellar.org/learn/composability-in-defi)
- [Blend and Meru case study](https://stellar.org/case-studies/meru-wallet-uses-blend-defi-protocol-for-yield)
