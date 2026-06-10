/**
 * Realistic seed data for the ILN mock backend.
 * All Stellar addresses follow the G…56-char format but are not real keys.
 */

import type { Invoice, PayerScore, Proposal, ProtocolParameters } from "./types.js";

// ─── Well-known test addresses ────────────────────────────────────────────────

export const ALICE   = "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3GLCXSIVW"; // freelancer
export const BOB     = "GBVZQCHFGWQGBLVZRAXITROHGWLBPFWXUSWRNKBFBQ7BXMFGNDKZWKHN"; // payer
export const CAROL   = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLIWLL873KBMCS3WHMEVL2"; // LP / funder
export const DAVE    = "GDMYVWI5YHKUQB3UQZEHBLKICL3WGQJRPQXM3P3VHEFBYUQFNMXXHXE"; // payer 2
export const EVE     = "GCLAQF5H5LGJ2A6ACOMNEHSWYDJ3VKVBUBHDWFGRBEPAVZ56L4D7KLPQ"; // freelancer 2
export const FRANK   = "GB6LLZFLHH2PFXOMUTPHXMKFN2GKBK7IZY4TT5ALXDJMJXQO7PE5IMI"; // LP 2
export const GRACE   = "GBSAIOPIQIQIJIJIJIJIJIJIJIJIJIJIJIJIJIJIJIJIJIJIJIJIIIIISP"; // payer 3 (stress addr)

// ─── Token contract IDs ───────────────────────────────────────────────────────

export const USDC_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
export const EURC_ID = "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP";

// ─── Time helpers ─────────────────────────────────────────────────────────────

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;

function daysFromNow(n: number): bigint {
  return BigInt(NOW + n * DAY);
}

function daysAgo(n: number): bigint {
  return BigInt(NOW - n * DAY);
}

// ─── Seed invoices ────────────────────────────────────────────────────────────
// 13 invoices covering all status combinations and both tokens.

export const SEED_INVOICES: Invoice[] = [
  // 1 – Pending, due in the future (USDC)
  {
    id: 1n,
    freelancer: ALICE,
    payer: BOB,
    amount: 5_000_000_000n,          // 500 USDC (7 decimals)
    due_date: daysFromNow(30),
    discount_rate: 500,               // 5%
    status: "Pending",
    funder: null,
    funded_at: null,
    token: USDC_ID,
  },
  // 2 – Pending, due in the future (EURC)
  {
    id: 2n,
    freelancer: EVE,
    payer: DAVE,
    amount: 3_500_000_000n,           // 350 EURC
    due_date: daysFromNow(15),
    discount_rate: 350,               // 3.5%
    status: "Pending",
    funder: null,
    funded_at: null,
    token: EURC_ID,
  },
  // 3 – Funded (USDC)
  {
    id: 3n,
    freelancer: ALICE,
    payer: BOB,
    amount: 10_000_000_000n,          // 1,000 USDC
    due_date: daysFromNow(45),
    discount_rate: 450,
    status: "Funded",
    funder: CAROL,
    funded_at: daysAgo(2),
    token: USDC_ID,
  },
  // 4 – Funded (EURC)
  {
    id: 4n,
    freelancer: EVE,
    payer: DAVE,
    amount: 7_500_000_000n,           // 750 EURC
    due_date: daysFromNow(60),
    discount_rate: 400,
    status: "Funded",
    funder: FRANK,
    funded_at: daysAgo(5),
    token: EURC_ID,
  },
  // 5 – Paid on time (USDC)
  {
    id: 5n,
    freelancer: ALICE,
    payer: BOB,
    amount: 2_000_000_000n,           // 200 USDC
    due_date: daysAgo(10),
    discount_rate: 300,
    status: "Paid",
    funder: CAROL,
    funded_at: daysAgo(40),
    token: USDC_ID,
  },
  // 6 – Paid on time (EURC)
  {
    id: 6n,
    freelancer: EVE,
    payer: BOB,
    amount: 1_500_000_000n,           // 150 EURC
    due_date: daysAgo(3),
    discount_rate: 250,
    status: "Paid",
    funder: FRANK,
    funded_at: daysAgo(25),
    token: EURC_ID,
  },
  // 7 – Defaulted (USDC)
  {
    id: 7n,
    freelancer: EVE,
    payer: DAVE,
    amount: 15_000_000_000n,          // 1,500 USDC
    due_date: daysAgo(20),
    discount_rate: 800,               // 8% — high risk matched the default
    status: "Defaulted",
    funder: CAROL,
    funded_at: daysAgo(50),
    token: USDC_ID,
  },
  // 8 – Cancelled before funding (USDC)
  {
    id: 8n,
    freelancer: ALICE,
    payer: DAVE,
    amount: 800_000_000n,             // 80 USDC
    due_date: daysFromNow(10),
    discount_rate: 200,
    status: "Cancelled",
    funder: null,
    funded_at: null,
    token: USDC_ID,
  },
  // 9 – Expired (past due, never funded)
  {
    id: 9n,
    freelancer: EVE,
    payer: BOB,
    amount: 4_200_000_000n,           // 420 USDC
    due_date: daysAgo(5),
    discount_rate: 600,
    status: "Expired",
    funder: null,
    funded_at: null,
    token: USDC_ID,
  },
  // 10 – Pending, large amount due soon (USDC)
  {
    id: 10n,
    freelancer: ALICE,
    payer: DAVE,
    amount: 50_000_000_000n,          // 5,000 USDC
    due_date: daysFromNow(7),
    discount_rate: 700,
    status: "Pending",
    funder: null,
    funded_at: null,
    token: USDC_ID,
  },
  // 11 – Funded, due very soon (USDC)
  {
    id: 11n,
    freelancer: EVE,
    payer: BOB,
    amount: 6_000_000_000n,           // 600 USDC
    due_date: daysFromNow(2),
    discount_rate: 550,
    status: "Funded",
    funder: FRANK,
    funded_at: daysAgo(10),
    token: USDC_ID,
  },
  // 12 – Paid, large amount (EURC)
  {
    id: 12n,
    freelancer: ALICE,
    payer: DAVE,
    amount: 25_000_000_000n,          // 2,500 EURC
    due_date: daysAgo(1),
    discount_rate: 400,
    status: "Paid",
    funder: CAROL,
    funded_at: daysAgo(35),
    token: EURC_ID,
  },
  // 13 – Pending, minimal amount (USDC)
  {
    id: 13n,
    freelancer: EVE,
    payer: BOB,
    amount: 100_000_000n,             // 10 USDC
    due_date: daysFromNow(90),
    discount_rate: 150,
    status: "Pending",
    funder: null,
    funded_at: null,
    token: USDC_ID,
  },
];

// ─── Seed reputation scores ───────────────────────────────────────────────────

export const SEED_REPUTATION: Map<string, PayerScore> = new Map([
  [BOB,  { score: 92, settled_on_time: 11, defaults: 0 }],
  [DAVE, { score: 45, settled_on_time: 3,  defaults: 2 }],
  [CAROL,{ score: 88, settled_on_time: 7,  defaults: 0 }],
  [EVE,  { score: 75, settled_on_time: 5,  defaults: 1 }],
  [FRANK,{ score: 99, settled_on_time: 20, defaults: 0 }],
]);

// ─── Seed token balances ──────────────────────────────────────────────────────
// key: `${tokenId}:${address}`

export const SEED_BALANCES: Map<string, bigint> = new Map([
  [`${USDC_ID}:${ALICE}`, 100_000_000_000n],   // 10,000 USDC
  [`${USDC_ID}:${BOB}`,   200_000_000_000n],   // 20,000 USDC
  [`${USDC_ID}:${CAROL}`, 500_000_000_000n],   // 50,000 USDC
  [`${USDC_ID}:${DAVE}`,   50_000_000_000n],   //  5,000 USDC
  [`${USDC_ID}:${EVE}`,    80_000_000_000n],   //  8,000 USDC
  [`${USDC_ID}:${FRANK}`, 300_000_000_000n],   // 30,000 USDC
  [`${EURC_ID}:${ALICE}`,  40_000_000_000n],   //  4,000 EURC
  [`${EURC_ID}:${BOB}`,    80_000_000_000n],   //  8,000 EURC
  [`${EURC_ID}:${EVE}`,    60_000_000_000n],   //  6,000 EURC
  [`${EURC_ID}:${FRANK}`, 120_000_000_000n],   // 12,000 EURC
]);

// ─── Seed token allowances ────────────────────────────────────────────────────
// key: `${tokenId}:${owner}:${spender}`

export const SEED_ALLOWANCES: Map<string, bigint> = new Map([
  // CAROL has pre-approved the contract to spend her USDC
  [`${USDC_ID}:${CAROL}:CONTRACT`, 50_000_000_000n],
  [`${EURC_ID}:${FRANK}:CONTRACT`, 20_000_000_000n],
]);

// ─── Seed governance proposals ────────────────────────────────────────────────

const G_NOW = Math.floor(Date.now() / 1000);
const G_DAY = 86_400;

export const SEED_PROPOSALS: Proposal[] = [
  {
    id: 1,
    title: "Reduce Base Discount Rate to 3.5%",
    description:
      "This proposal reduces the protocol's base discount rate from 5% to 3.5% to improve competitiveness with traditional invoice factoring services and attract higher invoice volume.",
    type: "ParameterUpdate",
    status: "Active",
    proposer: CAROL,
    createdAt: G_NOW - 2 * G_DAY,
    votingStartsAt: G_NOW - 2 * G_DAY,
    votingEndsAt: G_NOW + 5 * G_DAY,
    votesFor: 142_500,
    votesAgainst: 38_200,
    votesAbstain: 9_100,
    quorumRequired: 100_000,
    parameterChanges: [
      { parameter: "base_discount_rate", currentValue: "500 (5%)", newValue: "350 (3.5%)" },
    ],
  },
  {
    id: 2,
    title: "Increase Quorum Threshold to 15%",
    description:
      "Raise the minimum quorum from 10% to 15% of circulating ILN tokens to ensure governance decisions represent a meaningful fraction of the token supply.",
    type: "ParameterUpdate",
    status: "Active",
    proposer: FRANK,
    createdAt: G_NOW - 1 * G_DAY,
    votingStartsAt: G_NOW - 1 * G_DAY,
    votingEndsAt: G_NOW + 6 * G_DAY,
    votesFor: 56_000,
    votesAgainst: 71_300,
    votesAbstain: 4_200,
    quorumRequired: 100_000,
    parameterChanges: [
      { parameter: "quorum_threshold_bps", currentValue: "1000 (10%)", newValue: "1500 (15%)" },
    ],
  },
  {
    id: 3,
    title: "Add EURC as Accepted Invoice Currency",
    description:
      "Expand multi-token support by adding EURC (Euro Coin) alongside USDC, targeting European freelancers and eliminating FX conversion costs.",
    type: "ProtocolUpgrade",
    status: "Passed",
    proposer: BOB,
    createdAt: G_NOW - 14 * G_DAY,
    votingStartsAt: G_NOW - 14 * G_DAY,
    votingEndsAt: G_NOW - 7 * G_DAY,
    executableAfter: G_NOW - 4 * G_DAY,
    votesFor: 215_800,
    votesAgainst: 44_100,
    votesAbstain: 12_400,
    quorumRequired: 100_000,
    parameterChanges: [
      { parameter: "accepted_tokens", currentValue: "[USDC]", newValue: "[USDC, EURC]" },
    ],
  },
  {
    id: 4,
    title: "Extend Voting Period to 10 Days",
    description:
      "Increase the governance voting window from 7 to 10 days to give token holders adequate participation time across all time zones.",
    type: "ParameterUpdate",
    status: "Executed",
    proposer: ALICE,
    createdAt: G_NOW - 30 * G_DAY,
    votingStartsAt: G_NOW - 30 * G_DAY,
    votingEndsAt: G_NOW - 23 * G_DAY,
    executableAfter: G_NOW - 20 * G_DAY,
    votesFor: 189_600,
    votesAgainst: 22_300,
    votesAbstain: 6_100,
    quorumRequired: 100_000,
    parameterChanges: [
      { parameter: "voting_period_seconds", currentValue: "604800 (7 days)", newValue: "864000 (10 days)" },
    ],
  },
  {
    id: 5,
    title: "Signal: Explore On-Chain Credit Scoring Integration",
    description:
      "Gauge community sentiment on integrating a decentralised on-chain credit scoring module that could lower discount rates for freelancers with proven track records.",
    type: "TextProposal",
    status: "Failed",
    proposer: EVE,
    createdAt: G_NOW - 20 * G_DAY,
    votingStartsAt: G_NOW - 20 * G_DAY,
    votingEndsAt: G_NOW - 13 * G_DAY,
    votesFor: 44_200,
    votesAgainst: 88_700,
    votesAbstain: 11_500,
    quorumRequired: 100_000,
  },
  {
    id: 6,
    title: "Deploy LP Yield Optimiser Contract",
    description:
      "Deploy a new ancillary contract that auto-compounds LP yield by re-deploying earned USDC into the highest-APY invoice pool at the end of each epoch.",
    type: "ProtocolUpgrade",
    status: "Active",
    proposer: FRANK,
    createdAt: G_NOW - 3 * G_DAY,
    votingStartsAt: G_NOW - 3 * G_DAY,
    votingEndsAt: G_NOW + 4 * G_DAY,
    votesFor: 87_400,
    votesAgainst: 19_800,
    votesAbstain: 3_600,
    quorumRequired: 100_000,
  },
];

// ─── Seed protocol parameters ─────────────────────────────────────────────────

export const SEED_PROTOCOL_PARAMS: ProtocolParameters = {
  feeRateBps: 50,
  maxDiscountRateBps: 500,
  acceptedTokens: [
    { address: USDC_ID, name: "USD Coin",  symbol: "USDC" },
    { address: EURC_ID, name: "Euro Coin", symbol: "EURC" },
  ],
  minProposalILN: 500,
};

// ─── Token metadata ───────────────────────────────────────────────────────────

export const TOKEN_METADATA_MAP: Record<string, { name: string; symbol: string; decimals: number }> = {
  [USDC_ID]: { name: "USD Coin",  symbol: "USDC", decimals: 7 },
  [EURC_ID]: { name: "Euro Coin", symbol: "EURC", decimals: 7 },
};
