// !! AUTO-GENERATED — do not edit by hand.
// Re-generate with: pnpm generate:types
// Source: backend/target/spec.json
// Spec hash: 68fb69d3
// SDK version: 0.1.0

/** Response returned by the oracle's get_payer_data() entry point.\nCombines identity verification with a freshness timestamp so the\ncontract can reject stale data without a second round-trip. */
export interface OracleVerificationResponse {
  /** Whether the payer has passed oracle identity/creditworthiness checks. */
  is_verified: boolean;
  /** Ledger sequence number at which this data was last updated by the oracle.\nfund_invoice() rejects responses where current_ledger - timestamp \xe2\x89\xa5 max_oracle_age_ledgers. */
  timestamp: number;
}

/** The kind of off-chain data an oracle provides. */
export type OracleFeedType =
  | { tag: "Price" }
  | { tag: "Identity" }
  | { tag: "Credit" };

/** Point-in-time health snapshot for an oracle, recorded whenever\n`fund_invoice` (or another caller) queries it. There is no network\nlatency to measure on-chain \xe2\x80\x94 "response time" here means data\nstaleness: how many ledgers old the oracle's returned timestamp was\nat query time. */
export interface OracleHealthStatus {
  /** Number of consecutive queries (across calls) that returned stale\ndata. Resets to 0 on a fresh (non-stale) response. */
  consecutive_stale_count: number;
  /** Whether `last_data_age_ledgers` exceeded the configured max age. */
  is_stale: boolean;
  /** Ledger sequence at which this snapshot was recorded. */
  last_checked_ledger: number;
  /** `last_checked_ledger - last_data_timestamp`, i.e. how stale the data\nwas at query time. */
  last_data_age_ledgers: bigint;
  /** The `timestamp` field the oracle returned in its response. */
  last_data_timestamp: number;
    oracle: string;
}

/** Verification record returned by the oracle. */
export interface VerificationResult {
  /** Unix epoch seconds when the oracle last updated this entry. */
  timestamp: bigint;
  /** Whether the payer's off-chain identity/creditworthiness is verified. */
  verified: boolean;
}

/** NFT Metadata: complete information about an invoice NFT */
export interface InvoiceNftMetadata {
  /** Full invoice amount in stroops */
  amount: bigint;
  /** Discount rate in basis points (e.g. 300 = 3.00%) */
  discount_rate: number;
  /** Unix timestamp of when the invoice is due */
  due_date: number;
  /** The invoice ID this NFT represents */
  invoice_id: bigint;
  /** Timestamp when the NFT was minted */
  minted_at: number;
  /** Current owner of the NFT */
  owner: string;
  /** Token used for the invoice */
  token: string;
}

/** One entry in the admin action audit log. */
export interface AdminActionRecord {
  /** Name of the admin entry point that was called (e.g. "pause",\n"add_token"). */
  action: string;
  /** The admin address that authorized the call. */
  admin: string;
  /** Ledger sequence at which the action executed. */
  ledger: number;
  /** Monotonically increasing sequence number (never reused, even once\nthe corresponding ring-buffer slot is overwritten). */
  seq: bigint;
  /** Ledger close timestamp at which the action executed. */
  timestamp: bigint;
}

export interface Config {
    bonus_bps: number;
    decay_period_ledgers: bigint;
    decay_rate_bps: number;
    dispute_timeout_ledgers: bigint;
    eurc_sac_address: string;
    high_rep_threshold: number;
  /** Maximum acceptable oracle data age in ledgers before fund_invoice rejects it.\nDefault: 17_280 (\xe2\x89\x88 24 hours at one ledger per 5 seconds).\nUpdatable by governance via set_max_oracle_age(). */
  max_oracle_age_ledgers: bigint;
    min_discount_rate_bps: number;
    price_oracle: string | null;
    usdc_sac_address: string;
    xlm_sac_address: string;
}

export enum ContractError {
    InvoiceNotFound = 1,
    AlreadyFunded = 2,
    AlreadyPaid = 3,
    NotFunded = 4,
    Unauthorized = 5,
    InvalidAmount = 6,
    InvalidDiscountRate = 7,
    InvalidDueDate = 8,
    InvoiceDefaulted = 9,
    NothingToClaim = 10,
    NotYetDefaulted = 11,
    OverfundingRejected = 12,
    InvoiceExpired = 13,
    BatchTooLarge = 14,
    AlreadyCancelled = 15,
    AlreadyInitialized = 16,
  /** Payer attempted to appeal an invoice that is already in Appealed state. */
  AlreadyAppealed = 17,
  /** Appeal window has closed; appeal can no longer be submitted. */
  AppealWindowClosed = 18,
  /** Action requires the invoice to be in Defaulted state. */
  NotDefaulted = 19,
  /** LP has already joined the fund queue for this invoice. */
  AlreadyInQueue = 20,
  /** fund_invoice rejected because a different LP was selected by the priority queue. */
  NotApprovedFunder = 21,
  /** Invoice is in Appealed state and cannot be acted upon yet. */
  InvoiceAppealed = 22,
    AlreadyDisputed = 23,
    NotDisputed = 24,
    InvoiceDisputed = 25,
    ContractPaused = 26,
    DueDateTooSoon = 27,
    DueDateTooFar = 28,
    SelfInvoice = 29,
    OverpaymentRejected = 30,
  /** Issue #28: payer's reputation is below the configured minimum threshold. */
  PayerReputationTooLow = 31,
    ArithmeticOverflow = 32,
  /** Token charges a fee during `transfer`, causing the received amount to differ\nfrom the amount sent and breaking ILN accounting. */
  FeeOnTransferToken = 33,
  /** Issue #92: oracle returned unverified for the invoice payer when\nrequire_oracle_verification was set to true. */
  PayerUnverified = 34,
  /** Issue #93: oracle data is older than max_oracle_age_ledgers and must\nbe rejected to prevent stale-data attacks. */
  OracleDataStale = 35,
  /** Invoice amount is below the configurable minimum threshold. */
  AmountTooSmall = 36,
  /** Reentrant call detected \xe2\x80\x94 the function was called while already executing (Issue #535). */
  Reentrancy = 37,
  /** Rate-limited function called before the cooldown period elapsed (Issue #541). */
  RateLimited = 38,
  /** resolve_fund_queue called before the minimum queue maturity delay has\nelapsed since the first LP joined the queue.  Prevents MEV/front-running\nattacks where an attacker races to resolve the queue immediately after a\nhigh-reputation LP joins (Issue #MEV-1). */
  QueueNotMature = 39,
  /** Cross-contract dependency reported an incompatible interface version\n(or the version query failed) during configuration. */
  IncompatibleInterfaceVersion = 40,
  /** Issue #circuit-breaker: every oracle in the priority chain for this\nfeed type + token is circuit-tripped (or absent after excluding a\ntripped one) \xe2\x80\x94 oracle-gated funding must be rejected rather than\nsilently proceeding as if no oracle were configured. */
  OracleCircuitOpen = 41,
  /** Issue #price-deviation: no price source is registered for the\nrequested feed type, or every registered source failed to respond. */
  NoPriceSource = 42,
  /** Issue #price-deviation: every registered price source's report\ndeviated beyond the configured threshold from every other \xe2\x80\x94 no\nsource survived to produce a validated price. */
  AllPriceSourcesRejected = 43,
  /** Issue #655: invoice `amount` exceeds the governance-configured\nstaged-rollout per-invoice cap. */
  MaxInvoiceAmountExceeded = 44,
  /** Issue #655: funding this amount would push the token's cumulative\nfunded volume past the governance-configured staged-rollout cap. */
  GlobalVolumeCapExceeded = 45,
  /** Multisig admin was already bootstrapped; reconfiguration goes through\nan `UpdateMultisig` proposal. */
  MultisigAlreadyConfigured = 46,
  /** Signer list or threshold failed validation (empty, duplicates, or\nthreshold outside `1..=signers.len()`). */
  InvalidMultisigConfig = 47,
  /** A multisig operation ran before `initialize_multisig_admin`. */
  MultisigNotConfigured = 48,
  /** Caller is not in the configured multisig signer set. */
  NotAuthorizedSigner = 49,
  /** A pending, unexpired proposal already exists for this admin action. */
  DuplicateProposal = 50,
  /** No multisig proposal exists for the given id. */
  ProposalNotFound = 51,
  /** The proposal was already executed. */
  ProposalAlreadyExecuted = 52,
  /** The proposal's ledger window elapsed before it reached threshold. */
  ProposalExpired = 53,
  /** This signer already approved the proposal. */
  AlreadySigned = 54,
  /** Execution was requested before enough signers approved. */
  ThresholdNotReached = 55,
  /** A signer rotation is already scheduled. */
  RotationAlreadyPending = 56,
  /** No signer rotation is scheduled. */
  RotationNotFound = 57,
  /** The scheduled rotation's timelock has not elapsed. */
  RotationTimelockNotExpired = 58,
}

/** Emitted when governance adds a token to the funding allowlist (Issue #19). */
export interface TokenAdded {
  /** Number of decimal places for this token (e.g. 6 for USDC, 7 for XLM). */
  decimals: number;
    token: string;
}

export interface InvoicePaid {
  /** Full amount settled by payer */
  amount_paid: bigint;
    freelancer: string;
    invoice_id: bigint;
    lp: string;
  /** LP earnings = amount_paid - amount_funded */
  lp_earned: bigint;
  /** Total amount distributed to LP */
  lp_payout: bigint;
    paid_on_time: boolean;
    payer: string;
  /** Settlement ledger timestamp */
  settlement_timestamp: bigint;
    status: InvoiceStatus;
    token: string;
}

/** Emitted whenever the contract admin address is updated.\nProvides a permanent on-chain audit trail for admin transitions. */
export interface AdminChanged {
    new_admin: string;
    old_admin: string;
  /** Ledger timestamp of the change. */
  timestamp: bigint;
}

/** Emitted when governance removes a token from the funding allowlist (Issue #19). */
export interface TokenRemoved {
    token: string;
}

/** Emitted when an LP registers their intent to fund via the priority queue. */
export interface FundRequested {
    invoice_id: bigint;
    lp: string;
  /** LP's reputation score at the time of registration. */
  score: number;
}

export interface InvoiceFunded {
    amount_funded: bigint;
    discount_rate: number;
    due_date: bigint;
    effective_yield_bps: number;
    freelancer: string;
    fund_amount: bigint;
    funded_at: bigint | null;
    funder: string;
    invoice_amount: bigint;
    invoice_id: bigint;
    lp: string;
    payer: string;
    status: InvoiceStatus;
    timestamp: bigint;
    token: string;
}

/** Emitted when governance resolves a payer's appeal. */
export interface AppealResolved {
    invoice_id: bigint;
    payer: string;
    resolved_at: bigint;
  /** true = appeal upheld (default reversed); false = appeal rejected. */
  upheld: boolean;
}

export interface ContractPaused {
    timestamp: bigint;
}

export interface InvoiceExpired {
    freelancer: string;
    invoice_id: bigint;
    status: InvoiceStatus;
}

export interface InvoiceUpdated {
    amount: bigint;
    discount_rate: number;
    due_date: bigint;
    freelancer: string;
    invoice_id: bigint;
    payer: string;
    status: InvoiceStatus;
    token: string;
}

/** Emitted when a payer files an appeal against an unfair default marking. */
export interface DefaultAppealed {
    appealed_at: bigint;
  /** SHA-256 hash of off-chain evidence provided by the payer. */
  evidence_hash: Uint8Array;
    invoice_id: bigint;
    payer: string;
}

/** Emitted when governance resolves a dispute. */
export interface DisputeResolved {
    invoice_id: bigint;
    resolution: number;
    resolution_hash: Uint8Array;
    resolved_at: bigint;
}

/** Emitted when a payer disputes an invoice before settlement. */
export interface InvoiceDisputed {
    disputed_at: bigint;
    invoice_id: bigint;
    payer: string;
  /** SHA-256 hash of off-chain dispute evidence. */
  reason_hash: Uint8Array;
}

export interface ContractUnpaused {
    timestamp: bigint;
}

export interface ContractUpgraded {
    admin: string;
    new_wasm_hash: Uint8Array;
    timestamp: bigint;
}

export interface InvoiceCancelled {
    freelancer: string;
    invoice_id: bigint;
    status: InvoiceStatus;
}

export interface InvoiceDefaulted {
    amount: bigint;
    defaulted_at: bigint;
    discount_amount: bigint;
    due_date: bigint;
    freelancer: string;
    funder: string;
    invoice_id: bigint;
    payer: string;
    status: InvoiceStatus;
    token: string;
}

/** Emitted when an invoice NFT is burned (invoice marked paid). */
export interface InvoiceNftBurned {
    invoice_id: bigint;
    owner: string;
    timestamp: bigint;
}

/** Emitted when an invoice NFT is minted (invoice submitted). */
export interface InvoiceNftMinted {
    amount: bigint;
    due_date: number;
    invoice_id: bigint;
    owner: string;
    timestamp: bigint;
}

export interface InvoiceSubmitted {
    amount: bigint;
    discount_rate: number;
    due_date: bigint;
    freelancer: string;
    invoice_id: bigint;
    payer: string;
    referral_code: ReferralCode;
    status: InvoiceStatus;
  /** Ledger timestamp when the invoice was submitted.  Included so indexers\ncan reconstruct the full invoice record from events alone. */
  timestamp: bigint;
    token: string;
}

/** Emitted when an oracle is registered for a feed type, either as the\nfeed-type-wide default (`token: None`) or a per-token override\n(`token: Some(..)`) (Issue #532). */
export interface OracleRegistered {
    feed_type: OracleFeedType;
    oracle: string;
    token: string | null;
}

/** Emitted whenever a governance-controlled numeric parameter changes.\n\nThe `param_name` topic is a stable audit identifier. Keep these strings\nunique per parameter so off-chain indexers can reconstruct config history. */
export interface ParameterUpdated {
    new_value: bigint;
    old_value: bigint;
    param_name: string;
    updated_by: string;
}

/** Emitted when a price source is added to a feed type's multi-source list\n(Issue #price-deviation). */
export interface PriceSourceAdded {
    feed_type: OracleFeedType;
    oracle: string;
}

/** Emitted when the priority queue is resolved and a winning LP is selected. */
export interface FundQueueResolved {
    approved_lp: string;
    invoice_id: bigint;
  /** Winning score that secured priority. */
  score: number;
}

/** Emitted when an address's reputation score or counters are updated (Issue #32). */
export interface ReputationUpdated {
    address: string;
    invoices_defaulted: number;
    invoices_paid: number;
    invoices_submitted: number;
    new_score: number;
    old_score: number;
}

export interface InvoiceTransferred {
    invoice_id: bigint;
    new_freelancer: string;
    old_freelancer: string;
    status: InvoiceStatus;
}

/** Emitted when governance resets a tripped oracle circuit breaker. */
export interface OracleCircuitReset {
    feed_type: OracleFeedType;
    token: string;
}

/** Emitted when an oracle registration is removed (Issue #532). */
export interface OracleUnregistered {
    feed_type: OracleFeedType;
    token: string | null;
}

/** Emitted when the admin sets/changes the price oracle address\n(Issue #538: event emission completeness audit). */
export interface PriceOracleUpdated {
    new_oracle: string;
    old_oracle: string | null;
    updated_by: string;
}

/** Emitted when a price source is removed from a feed type's multi-source list. */
export interface PriceSourceRemoved {
    feed_type: OracleFeedType;
    oracle: string;
}

/** Emitted once, when the contract is initialised\n(Issue #538: event emission completeness audit). */
export interface ContractInitialized {
    admin: string;
    eurc_token: string;
    timestamp: bigint;
    usdc_token: string;
    xlm_token: string;
}

export interface InvoiceTokenChanged {
    invoice_id: bigint;
    new_token: string;
    old_token: string;
}

export interface InvoicePartiallyPaid {
    amount_paid_now: bigint;
    invoice_id: bigint;
    payer: string;
    remaining_amount: bigint;
    total_amount_paid: bigint;
}

/** Emitted once when a feed type + token's oracle resolution channel is\nautomatically circuit-tripped after `MAX_CONSECUTIVE_STALE_QUERIES`\nconsecutive stale responses from the same oracle. `token` is included\nalongside the task-specified `feed_type`/`consecutive_stale_count`\nfields \xe2\x80\x94 matching `OracleHealthRecorded`'s shape \xe2\x80\x94 since a bare\nfeed-type-only event wouldn't identify which resolution channel tripped\nin a deployment with multiple per-token overrides. */
export interface OracleCircuitTripped {
    consecutive_stale_count: number;
    feed_type: OracleFeedType;
    token: string;
}

/** Emitted every time `fund_invoice` (or another caller) queries an oracle,\nrecording its staleness at that moment (Issue #532). */
export interface OracleHealthRecorded {
    consecutive_stale_count: number;
    feed_type: OracleFeedType;
    is_stale: boolean;
    last_data_age_ledgers: bigint;
    token: string;
}

/** Emitted when a registered price source's reported price is rejected as\nan outlier relative to the cross-source median (Issue #price-deviation). */
export interface PriceOutlierRejected {
    deviation_bps: number;
    feed_type: OracleFeedType;
    median_price: bigint;
    oracle: string;
    reported_price: bigint;
    token: string;
}

/** Emitted when an invoice NFT is transferred (e.g. freelancer \xe2\x86\x92 LP on funding). */
export interface InvoiceNftTransferred {
    from: string;
    invoice_id: bigint;
    timestamp: bigint;
    to: string;
}

export interface LPPositionTransferred {
    invoice_id: bigint;
    new_lp: string;
    old_lp: string;
    status: InvoiceStatus;
}

/** Emitted after `claim_default` attempts to compensate the claiming LP from\nthe configured insurance pool. `compensated` is `false` when the LP\nwasn't enrolled, no pool is configured, or the pool call failed/was\nunavailable (Issue #529). */
export interface InsuranceClaimAttempted {
    compensated: boolean;
    invoice_id: bigint;
    lp: string;
    payout: bigint;
}

/** Issue #640: emitted when a pending signer rotation is cancelled before\nit takes effect. */
export interface SignerRotationCancelled {
    new_signer: string;
    old_signer: string;
}

/** Issue #640: emitted once a scheduled rotation's timelock has elapsed\nand the signer swap has actually been applied. */
export interface SignerRotationFinalized {
    new_signer: string;
    old_signer: string;
}

/** Issue #640: emitted when a multisig-approved `RotateSigner` proposal\nexecutes, scheduling (but not yet applying) the signer swap. */
export interface SignerRotationScheduled {
    effective_at: bigint;
    new_signer: string;
    old_signer: string;
}

/** Emitted when a dispute resolution in favor of the payer refunds partial payments to the payer. */
export interface DisputeUpheldPayerRefund {
    amount: bigint;
    invoice_id: bigint;
    payer: string;
}

/** Emitted when the admin sets/changes the distribution contract address\n(Issue #538: event emission completeness audit). */
export interface DistributionContractUpdated {
    new_distribution_contract: string;
    old_distribution_contract: string | null;
    updated_by: string;
}

/** Emitted when an enrolled LP's insurance `claim()` call fails (panic, error,\nor incompatible pool) so operators can observe compensation failure\nwithout the core default path reverting. */
export interface InsuranceCompensationFailed {
    invoice_id: bigint;
    lp: string;
    pool: string;
}

/** Emitted whenever `resolve_fund_queue` is called, regardless of outcome.\n`success=true` means a winner was selected; `success=false` means the\ncall was rejected (e.g. maturity delay not yet elapsed).\n\nUseful for off-chain monitoring to detect MEV attempts and track queue\nactivity (Issue #MEV-1). */
export interface FundQueueResolutionAttempted {
  /** Ledger sequence when the attempt was made. */
  attempted_at_ledger: number;
  /** Caller that triggered the resolution attempt. */
  caller_ledger: number;
    invoice_id: bigint;
  /** Whether the resolution succeeded. */
  success: boolean;
}

export interface Invoice {
    amount: bigint;
    amount_funded: bigint;
    amount_paid: bigint;
    discount_rate: number;
    due_date: number;
    freelancer: string;
    funded_at: number | null;
    funder: string | null;
    id: bigint;
    payer: string;
    referral_code: ReferralCode;
    status: InvoiceStatus;
    submitter_reputation: number;
    token: string;
}

export interface PayerStats {
    defaults: bigint;
    paid_on_time: bigint;
    total_invoices: bigint;
    total_volume: bigint;
}

export interface InvoiceCore {
    amount: bigint;
    amount_funded: bigint;
    amount_paid: bigint;
    discount_rate: number;
    due_date: number;
    freelancer: string;
    id: bigint;
    payer: string;
    status: InvoiceStatus;
    token: string;
}

export interface AppealRecord {
  /** Ledger timestamp when the appeal was filed. */
  appealed_at: number;
  /** SHA-256 hash of off-chain evidence submitted by the payer. */
  evidence_hash: Uint8Array;
  /** Payer reputation score just before the default was applied,\nused to restore the score if the appeal is upheld. */
  pre_default_score: number;
}

/** A nullable BytesN<32> that works with #[contracttype] derive.\nIn Soroban SDK 21.x, `Option<BytesN<32>>` doesn't implement the required\nScVal conversion traits, so we use this wrapper enum instead. */
export type ReferralCode =
  | { tag: "None" }
  | { tag: "Present"; values: [Uint8Array] };

export interface ContractStats {
    token_volumes: [string, bigint][];
    total_funded: bigint;
    total_invoices: bigint;
    total_paid: bigint;
    total_volume_eurc: bigint;
    total_volume_usd_normalized: bigint;
    total_volume_usdc: bigint;
    total_volume_xlm: bigint;
}

export interface DisputeRecord {
  /** Ledger sequence when the dispute was filed. */
  disputed_at: number;
  /** SHA-256 hash of off-chain dispute evidence. */
  reason_hash: Uint8Array;
}

export interface InvoiceParams {
    amount: bigint;
    discount_rate: number;
    due_date: bigint;
    freelancer: string;
    payer: string;
    referral_code: ReferralCode;
    token: string;
}

export type InvoiceStatus =
  | { tag: "Pending" }
  | { tag: "Funded" }
  | { tag: "PartiallyFunded" }
  | { tag: "Paid" }
  | { tag: "Defaulted" }
  | { tag: "Appealed" }
  | { tag: "Disputed" }
  | { tag: "Expired" }
  | { tag: "Cancelled" };

export interface LpFundRequest {
    lp: string;
  /** LP reputation score snapshotted at request time (used for ordering). */
  score: number;
}

export interface TopPayerEntry {
    address: string;
    score: number;
}

/** Issue #775: operationally-relevant protocol state in a single read, for a\npublic "is the protocol paused, and why" status view (contract-side) and\nthe indexer's public `/protocol-status` endpoint (off-chain).\n\nThis is deliberately distinct from the admin-only dashboard data \xe2\x80\x94 every\nfield here is safe to expose publicly and is what a user or an on-call\nresponder needs during an incident. */
export interface ProtocolStatus {
  /** The address `require_admin` authorizes against today (may itself be a\nStellar account-level multisig \xe2\x80\x94 the contract cannot tell). */
  admin: string;
  /** Ledger timestamp of the most recent `pause()`; `0` if never paused. */
  last_pause_timestamp: bigint;
  /** Whether the contract-level multisig admin has been bootstrapped\n(`initialize_multisig_admin`). */
  multisig_configured: boolean;
  /** Number of authorized multisig signers; `0` when not configured. */
  multisig_signer_count: number;
  /** Signatures required to execute a multisig admin action; `0` when the\nmultisig is not configured. */
  multisig_threshold: number;
  /** Whether at least one oracle circuit breaker (feed type + token) is\ncurrently tripped, halting oracle-gated funding on that channel. */
  oracle_circuit_tripped: boolean;
  /** How many (feed type, token) oracle circuit breakers are tripped. */
  oracle_circuits_tripped: number;
  /** Whether all mutating entry points are currently halted (`pause()`). */
  paused: boolean;
}

export interface InvoiceMetadata {
    funded_at: number | null;
    funder: string | null;
    referral_code: ReferralCode;
    submitter_reputation: number;
}

export interface ReputationScore {
    last_activity_ledger: number;
    score: number;
}

/** Detailed reputation profile for an address (Issue #26).\n\n**Protocol source of truth** for ILN reputation counters used by funding\ngates, defaults, and appeals. This is independent of the\n`reputation_bonus` crate's own `ReputationScore` storage \xe2\x80\x94 the two never\nsync (see `docs/adr/ADR-011-reputation-state-source-of-truth.md`).\n\nThe lightweight [`ReputationScore`] holds the decaying score used by the\npayer/LP scoring path; this profile records the richer counters. Unknown\naddresses resolve to a zeroed profile (see [`get_reputation`]) rather than\npanicking. */
export interface ReputationProfile {
    address: string;
    invoices_defaulted: number;
    invoices_paid: number;
    invoices_submitted: number;
    score: number;
}

export type DataKey =
  | { tag: "Admin" }
  | { tag: "Config" }
  | { tag: "FeeRate" }
  | { tag: "MaxDiscountRate" }
  | { tag: "DistributionContract" }
  | { tag: "Paused" }
  | { tag: "MinPayerReputation" }
  | { tag: "NextInvoiceId" }
  | { tag: "MaxInvoiceAmount" }
  | { tag: "Invoice"; values: [bigint] }
  | { tag: "InvoiceCore"; values: [bigint] }
  | { tag: "InvoiceMetadata"; values: [bigint] }
  | { tag: "InvoiceCount" }
  | { tag: "Token" }
  | { tag: "PayerScore"; values: [string] }
  | { tag: "InvoiceFunders"; values: [bigint] }
  | { tag: "ApprovedToken"; values: [string] }
  | { tag: "TokenList" }
  | { tag: "TokenDecimals"; values: [string] }
  | { tag: "Reputation"; values: [string] }
  | { tag: "Appeal"; values: [bigint] }
  | { tag: "PreDefaultPayerScore"; values: [bigint] }
  | { tag: "LpScore"; values: [string] }
  | { tag: "FundQueue"; values: [bigint] }
  | { tag: "QueueResolution"; values: [bigint] }
  | { tag: "FundQueueOpenedAt"; values: [bigint] }
  | { tag: "AdminActionLog"; values: [number] }
  | { tag: "AdminActionCount" }
  | { tag: "TotalInvoices" }
  | { tag: "TotalFunded" }
  | { tag: "TotalPaid" }
  | { tag: "TotalVolumeUsdc" }
  | { tag: "TotalVolumeEurc" }
  | { tag: "TotalVolumeXlm" }
  | { tag: "TokenVolume"; values: [string] }
  | { tag: "TokenVolumeCap"; values: [string] }
  | { tag: "ReferralCount"; values: [Uint8Array] }
  | { tag: "Dispute"; values: [bigint] }
  | { tag: "SubmitterInvoices"; values: [string] }
  | { tag: "LpInvoices"; values: [string] }
  | { tag: "TopPayersHeap" }
  | { tag: "InvoiceNft"; values: [bigint] }
  | { tag: "InvoiceNftOwner"; values: [bigint] }
  | { tag: "FeeTiers" }
  | { tag: "StorageVersion" }
  | { tag: "ReentrancyLock" }
  | { tag: "RateLimit"; values: [string] }
  | { tag: "OracleRegistry"; values: [OracleFeedType] }
  | { tag: "TokenOracle"; values: [OracleFeedType, string] }
  | { tag: "OracleHealth"; values: [OracleFeedType, string] }
  | { tag: "InsurancePool" }
  | { tag: "InsurancePoolInterfaceVersion" }
  | { tag: "OracleInterfaceVersion"; values: [OracleFeedType] }
  | { tag: "OracleCircuitTripped"; values: [OracleFeedType, string] }
  | { tag: "PriceSources"; values: [OracleFeedType] }
  | { tag: "MaxPriceDeviationBps" }
  | { tag: "MultisigAdmin" }
  | { tag: "MultisigProposal"; values: [bigint] }
  | { tag: "NextProposalId" }
  | { tag: "PendingActionProposal"; values: [AdminAction] }
  | { tag: "PendingSignerRotation" }
  | { tag: "LastPauseTimestamp" };

/** Enumeration of admin actions that require multi-sig approval */
export type AdminAction =
  | { tag: "Pause" }
  | { tag: "Unpause" }
  | { tag: "RemoveToken"; values: [string] }
  | { tag: "SetFeeRate"; values: [number] }
  | { tag: "SetMaxDiscount"; values: [number] }
  | { tag: "UpdateMultisig"; values: [string[], number] }
  | { tag: "RotateSigner"; values: [string, string] };

/** Multi-signature admin configuration */
export interface MultisigAdmin {
  /** List of authorized signers */
  signers: string[];
  /** Number of signatures required to execute an action */
  threshold: number;
}

/** A proposal for an admin action awaiting signatures */
export type ProposalState =
  | { tag: "Pending" }
  | { tag: "Executed" }
  | { tag: "Expired" };

/** A signer rotation approved by the multisig but not yet applied. */
export interface PendingRotation {
  /** Ledger sequence at/after which `finalize_rotation` may be called. */
  effective_at: bigint;
    new_signer: string;
    old_signer: string;
}

export interface MultisigProposal {
  /** The proposed action */
  action: AdminAction;
  /** Ledger sequence number when this proposal expires */
  expires_at: bigint;
  /** Unique proposal ID */
  id: bigint;
  /** List of signers who have approved this proposal */
  signers_approved: string[];
  /** Current state of the proposal */
  state: ProposalState;
}
