import {
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  Account,
  BASE_FEE,
  Operation,
  xdr,
} from "@stellar/stellar-sdk";

import type { RpcServerLike } from "./types";
import type {
  LPCoverage,
  InsuranceClaim,
  PoolBalance,
  ClaimStatus,
  EnrollParams,
  DepositPremiumParams,
  SubmitClaimParams,
  ReviewClaimParams,
} from "./insurance-types";

const READ_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

type BuiltTransaction = ReturnType<typeof TransactionBuilder.prototype.build>;

export interface InsuranceClientConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  server?: RpcServerLike;
}

export class InsurancePoolClient {
  private readonly contractId: string;
  private readonly networkPassphrase: string;
  private readonly server: RpcServerLike;

  constructor(config: InsuranceClientConfig) {
    this.contractId = config.contractId;
    this.networkPassphrase = config.networkPassphrase;
    this.server = config.server ?? new rpc.Server(config.rpcUrl);
  }

  private buildReadTransaction(method: string, args: xdr.ScVal[]): BuiltTransaction {
    return new TransactionBuilder(new Account(READ_ACCOUNT, "0"), {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: this.contractId,
          function: method,
          args,
        }),
      )
      .setTimeout(30)
      .build();
  }

  private async buildWriteTransaction(
    sourceAddress: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<BuiltTransaction> {
    const sourceAccount = (await this.server.getAccount(sourceAddress)) as Account;
    return new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: this.contractId,
          function: method,
          args,
        }),
      )
      .setTimeout(30)
      .build();
  }

  private async simulate(transaction: BuiltTransaction, method: string): Promise<unknown> {
    const simulation = (await this.server.simulateTransaction(transaction)) as {
      error?: unknown;
      result?: { retval?: xdr.ScVal };
    };
    if (simulation.error) {
      throw new Error(`Simulation failed for ${method}: ${String(simulation.error)}`);
    }
    return simulation;
  }

  private extractRetval(simulation: unknown): unknown {
    const sim = simulation as { result?: { retval?: xdr.ScVal } };
    if (!sim.result?.retval) {
      throw new Error("RPC simulation did not return a contract result.");
    }
    return scValToNative(sim.result.retval as xdr.ScVal);
  }

  private unwrapResult(value: unknown, method: string): unknown {
    if (!value || typeof value !== "object") {
      return value;
    }
    if ("ok" in value) {
      return (value as { ok: unknown }).ok;
    }
    if ("Ok" in value) {
      return (value as { Ok: unknown }).Ok;
    }
    if ("err" in value) {
      throw new Error(`Contract rejected ${method}: ${JSON.stringify((value as { err: unknown }).err)}`);
    }
    if ("Err" in value) {
      throw new Error(`Contract rejected ${method}: ${JSON.stringify((value as { Err: unknown }).Err)}`);
    }
    return value;
  }

  private toAddress(address: string): xdr.ScVal {
    return { address: () => address } as unknown as xdr.ScVal;
  }

  private toOptionalClaimStatus(status: ClaimStatus | undefined): xdr.ScVal {
    if (!status) {
      return xdr.ScVal.scvVoid();
    }
    return nativeToScVal(status, { type: "string" });
  }

  private parseLPCoverage(value: unknown): LPCoverage | null {
    if (!value || typeof value !== "object") {
      return null;
    }
    const v = value as Record<string, unknown>;
    return {
      address: String(v.address ?? ""),
      enrolledAt: Number(v.enrolled_at ?? v.enrolledAt ?? 0),
      coverageAmount: BigInt(String(v.coverage_amount ?? v.coverageAmount ?? 0)),
      premiumRateBps: Number(v.premium_rate_bps ?? v.premiumRateBps ?? 0),
      totalPremiumsPaid: BigInt(String(v.total_premiums_paid ?? v.totalPremiumsPaid ?? 0)),
      activeClaims: Number(v.active_claims ?? v.activeClaims ?? 0),
      totalClaims: Number(v.total_claims ?? v.totalClaims ?? 0),
      claimsApproved: Number(v.claims_approved ?? v.claimsApproved ?? 0),
      claimsRejected: Number(v.claims_rejected ?? v.claimsRejected ?? 0),
      totalPayoutReceived: BigInt(String(v.total_payout_received ?? v.totalPayoutReceived ?? 0)),
    };
  }

  private parseClaim(value: unknown): InsuranceClaim {
    const v = value as Record<string, unknown>;
    const statusRaw = v.status as Record<string, string> | string;
    const status = typeof statusRaw === "string" ? statusRaw : Object.keys(statusRaw ?? {})[0] ?? "Pending";

    return {
      id: BigInt(String(v.id ?? 0)),
      lp: String(v.lp ?? ""),
      invoiceId: BigInt(String(v.invoice_id ?? v.invoiceId ?? 0)),
      invoiceAmount: BigInt(String(v.invoice_amount ?? v.invoiceAmount ?? 0)),
      reason: String(v.reason ?? ""),
      status: status as ClaimStatus,
      filedAt: Number(v.filed_at ?? v.filedAt ?? 0),
      reviewedAt: v.reviewed_at != null ? Number(v.reviewed_at) : v.reviewedAt != null ? Number(v.reviewedAt) : null,
      reviewer: v.reviewer ? String(v.reviewer) : null,
      rejectionReason: v.rejection_reason ? String(v.rejection_reason) : v.rejectionReason ? String(v.rejectionReason) : null,
      payoutAmount: v.payout_amount != null ? BigInt(String(v.payout_amount)) : v.payoutAmount != null ? BigInt(String(v.payoutAmount)) : null,
    };
  }

  private parsePoolBalance(value: unknown): PoolBalance {
    const v = value as Record<string, unknown>;
    return {
      totalPremiums: BigInt(String(v.total_premiums ?? v.totalPremiums ?? 0)),
      totalPayouts: BigInt(String(v.total_payouts ?? v.totalPayouts ?? 0)),
      reserveBalance: BigInt(String(v.reserve_balance ?? v.reserveBalance ?? 0)),
      enrolledLps: Number(v.enrolled_lps ?? v.enrolledLps ?? 0),
      activeClaims: Number(v.active_claims ?? v.activeClaims ?? 0),
      pendingClaims: Number(v.pending_claims ?? v.pendingClaims ?? 0),
      approvedClaims: Number(v.approved_claims ?? v.approvedClaims ?? 0),
      rejectedClaims: Number(v.rejected_claims ?? v.rejectedClaims ?? 0),
    };
  }

  async getLPCoverage(lp: string): Promise<LPCoverage | null> {
    const tx = this.buildReadTransaction("get_lp_coverage", [
      this.toAddress(lp),
    ]);
    const sim = await this.simulate(tx, "get_lp_coverage");
    const raw = this.unwrapResult(this.extractRetval(sim), "get_lp_coverage");
    return this.parseLPCoverage(raw);
  }

  async getPoolBalance(): Promise<PoolBalance> {
    const tx = this.buildReadTransaction("get_pool_balance", []);
    const sim = await this.simulate(tx, "get_pool_balance");
    const raw = this.unwrapResult(this.extractRetval(sim), "get_pool_balance");
    return this.parsePoolBalance(raw);
  }

  async getClaim(claimId: bigint): Promise<InsuranceClaim> {
    const tx = this.buildReadTransaction("get_claim", [
      nativeToScVal(claimId, { type: "u64" }),
    ]);
    const sim = await this.simulate(tx, "get_claim");
    const raw = this.unwrapResult(this.extractRetval(sim), "get_claim");
    return this.parseClaim(raw);
  }

  async listClaims(
    statusFilter?: ClaimStatus,
    page = 0,
    pageSize = 20,
  ): Promise<InsuranceClaim[]> {
    const tx = this.buildReadTransaction("list_claims", [
      this.toOptionalClaimStatus(statusFilter),
      nativeToScVal(page, { type: "u32" }),
      nativeToScVal(pageSize, { type: "u32" }),
    ]);
    const sim = await this.simulate(tx, "list_claims");
    const raw = this.unwrapResult(this.extractRetval(sim), "list_claims");
    const claims = Array.isArray(raw) ? raw : [];
    return claims.map((c: unknown) => this.parseClaim(c));
  }

  async buildEnrollTransaction(params: EnrollParams): Promise<BuiltTransaction> {
    return this.buildWriteTransaction(params.lp, "enroll", [
      this.toAddress(params.lp),
      nativeToScVal(params.coverageAmount, { type: "i128" }),
      nativeToScVal(params.premiumRateBps, { type: "u32" }),
    ]);
  }

  async buildDepositPremiumTransaction(params: DepositPremiumParams): Promise<BuiltTransaction> {
    return this.buildWriteTransaction(params.lp, "deposit_premium", [
      this.toAddress(params.lp),
      nativeToScVal(params.amount, { type: "i128" }),
    ]);
  }

  async buildClaimTransaction(params: SubmitClaimParams): Promise<BuiltTransaction> {
    return this.buildWriteTransaction(params.lp, "claim", [
      this.toAddress(params.lp),
      nativeToScVal(params.invoiceId, { type: "u64" }),
      nativeToScVal(params.reason, { type: "string" }),
    ]);
  }

  async buildReviewClaimTransaction(params: ReviewClaimParams): Promise<BuiltTransaction> {
    const reasonScVal = params.reason
      ? nativeToScVal(params.reason, { type: "string" })
      : xdr.ScVal.scvVoid();
    return this.buildWriteTransaction(params.reviewer, "review_claim", [
      this.toAddress(params.reviewer),
      nativeToScVal(params.claimId, { type: "u64" }),
      nativeToScVal(params.approve, { type: "bool" }),
      reasonScVal,
    ]);
  }
}
