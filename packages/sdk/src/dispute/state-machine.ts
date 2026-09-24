import type {
  Invoice,
  InvoiceStatus,
  DisputeRecord,
  DisputeEvidence,
  DisputeReasonCategory,
  DisputeResolutionDecision,
  DisputeStatus,
  DisputeAnalytics,
} from '@iln/shared';

export const DEFAULT_EVIDENCE_PERIOD_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const DEFAULT_AUTO_RESOLVE_PERIOD_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface FileDisputeParams {
  invoice: Invoice;
  disputer: string;
  reasonCategory: DisputeReasonCategory;
  reasonDescription: string;
  evidenceCid: string;
  now?: number;
  evidencePeriodSeconds?: number;
  autoResolvePeriodSeconds?: number;
}

export interface SubmitEvidenceParams {
  dispute: DisputeRecord;
  submitter: string;
  role: 'payer' | 'freelancer' | 'admin';
  evidenceCid: string;
  description: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  now?: number;
}

export interface ResolveDisputeParams {
  dispute: DisputeRecord;
  resolver: string;
  decision: DisputeResolutionDecision;
  notes?: string;
  now?: number;
}

export interface AutoResolveDisputeParams {
  dispute: DisputeRecord;
  now?: number;
}

export class DisputeStateMachine {
  /**
   * Checks whether an invoice is eligible to be disputed.
   */
  public static canDispute(invoice: Invoice, disputer: string): { allowed: boolean; reason?: string } {
    const validStates: InvoiceStatus[] = ['Pending', 'Funded', 'PartiallyFunded'];
    if (!validStates.includes(invoice.status)) {
      return {
        allowed: false,
        reason: `Cannot dispute an invoice in '${invoice.status}' state. Must be Pending, Funded, or PartiallyFunded.`,
      };
    }

    if (disputer !== invoice.payer && disputer !== invoice.freelancer) {
      return {
        allowed: false,
        reason: `Only invoice payer or freelancer may dispute this invoice. Disputer: ${disputer}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Files a new dispute on an invoice and creates the DisputeRecord.
   */
  public static fileDispute(params: FileDisputeParams): { dispute: DisputeRecord; nextInvoiceStatus: InvoiceStatus } {
    const check = this.canDispute(params.invoice, params.disputer);
    if (!check.allowed) {
      throw new Error(check.reason);
    }

    if (!params.evidenceCid || params.evidenceCid.trim() === '') {
      throw new Error('Evidence CID is required to file a dispute.');
    }

    const now = params.now ?? Math.floor(Date.now() / 1000);
    const evidencePeriod = params.evidencePeriodSeconds ?? DEFAULT_EVIDENCE_PERIOD_SECONDS;
    const autoResolvePeriod = params.autoResolvePeriodSeconds ?? DEFAULT_AUTO_RESOLVE_PERIOD_SECONDS;

    const initialEvidence: DisputeEvidence = {
      id: `ev-${now}-1`,
      submitter: params.disputer,
      role: params.disputer === params.invoice.payer ? 'payer' : 'freelancer',
      evidenceCid: params.evidenceCid,
      description: params.reasonDescription,
      submittedAt: now,
    };

    const dispute: DisputeRecord = {
      invoiceId: params.invoice.id,
      disputer: params.disputer,
      reasonCategory: params.reasonCategory,
      reasonDescription: params.reasonDescription,
      evidenceCid: params.evidenceCid,
      evidence: [initialEvidence],
      filedAt: now,
      evidenceDeadline: now + evidencePeriod,
      autoResolveAt: now + autoResolvePeriod,
      status: 'Pending',
      resolvedAt: null,
      resolvedBy: null,
      resolutionDecision: null,
      resolutionNotes: null,
    };

    return {
      dispute,
      nextInvoiceStatus: 'Disputed',
    };
  }

  /**
   * Submits evidence for an ongoing dispute before the evidence deadline.
   */
  public static submitEvidence(params: SubmitEvidenceParams): DisputeRecord {
    if (params.dispute.status !== 'Pending') {
      throw new Error(`Cannot submit evidence for a dispute with status '${params.dispute.status}'.`);
    }

    const now = params.now ?? Math.floor(Date.now() / 1000);
    if (now > params.dispute.evidenceDeadline) {
      throw new Error(`Evidence submission window closed at timestamp ${params.dispute.evidenceDeadline}.`);
    }

    if (!params.evidenceCid || params.evidenceCid.trim() === '') {
      throw new Error('Evidence CID cannot be empty.');
    }

    const newEvidence: DisputeEvidence = {
      id: `ev-${now}-${params.dispute.evidence.length + 1}`,
      submitter: params.submitter,
      role: params.role,
      evidenceCid: params.evidenceCid,
      description: params.description,
      fileName: params.fileName,
      fileType: params.fileType,
      fileSize: params.fileSize,
      submittedAt: now,
    };

    return {
      ...params.dispute,
      evidence: [...params.dispute.evidence, newEvidence],
    };
  }

  /**
   * Resolves a dispute through admin arbitration.
   */
  public static resolveDispute(params: ResolveDisputeParams): {
    dispute: DisputeRecord;
    nextInvoiceStatus: InvoiceStatus;
  } {
    if (params.dispute.status !== 'Pending') {
      throw new Error(`Dispute is already resolved (status: '${params.dispute.status}').`);
    }

    const now = params.now ?? Math.floor(Date.now() / 1000);
    const newStatus: DisputeStatus =
      params.decision === 'favor_payer' ? 'ResolvedFavorPayer' : 'ResolvedFavorFreelancer';

    const nextInvoiceStatus: InvoiceStatus = params.decision === 'favor_payer' ? 'Cancelled' : 'Paid';

    const updatedDispute: DisputeRecord = {
      ...params.dispute,
      status: newStatus,
      resolvedAt: now,
      resolvedBy: params.resolver,
      resolutionDecision: params.decision,
      resolutionNotes: params.notes ?? null,
    };

    return {
      dispute: updatedDispute,
      nextInvoiceStatus,
    };
  }

  /**
   * Automatically resolves a dispute once the timeout is reached (defaults to favoring freelancer).
   */
  public static autoResolveDispute(params: AutoResolveDisputeParams): {
    dispute: DisputeRecord;
    nextInvoiceStatus: InvoiceStatus;
  } {
    if (params.dispute.status !== 'Pending') {
      throw new Error(`Dispute is already resolved (status: '${params.dispute.status}').`);
    }

    const now = params.now ?? Math.floor(Date.now() / 1000);
    if (now < params.dispute.autoResolveAt) {
      throw new Error(
        `Auto-resolution timeout not yet reached. Auto-resolves at ${params.dispute.autoResolveAt}, current is ${now}.`
      );
    }

    const updatedDispute: DisputeRecord = {
      ...params.dispute,
      status: 'AutoResolvedFavorFreelancer',
      resolvedAt: now,
      resolvedBy: 'system:auto-resolve',
      resolutionDecision: 'favor_freelancer',
      resolutionNotes: 'Auto-resolved in favor of freelancer after dispute timeout.',
    };

    return {
      dispute: updatedDispute,
      nextInvoiceStatus: 'Paid',
    };
  }

  /**
   * Computes dispute analytics from a collection of disputes and invoices.
   */
  public static computeAnalytics(
    disputes: DisputeRecord[],
    invoices: Invoice[] = []
  ): DisputeAnalytics {
    const totalDisputes = disputes.length;

    // Dispute rate by payer: count disputes / total invoices submitted by that payer
    const payerInvoiceCounts: Record<string, number> = {};
    const payerDisputeCounts: Record<string, number> = {};

    for (const inv of invoices) {
      payerInvoiceCounts[inv.payer] = (payerInvoiceCounts[inv.payer] || 0) + 1;
    }

    for (const d of disputes) {
      payerDisputeCounts[d.disputer] = (payerDisputeCounts[d.disputer] || 0) + 1;
    }

    const disputeRateByPayer: Record<string, number> = {};
    for (const [payer, dCount] of Object.entries(payerDisputeCounts)) {
      const total = payerInvoiceCounts[payer] ?? dCount;
      disputeRateByPayer[payer] = total > 0 ? dCount / total : 1;
    }

    // Resolution times
    const resolvedDisputes = disputes.filter((d) => d.resolvedAt !== null);
    const totalResolutionTime = resolvedDisputes.reduce((acc, d) => {
      return acc + (d.resolvedAt! - d.filedAt);
    }, 0);
    const averageResolutionTimeSeconds =
      resolvedDisputes.length > 0 ? Math.round(totalResolutionTime / resolvedDisputes.length) : 0;

    // Win rate by party
    let payerWins = 0;
    let freelancerWins = 0;

    for (const d of resolvedDisputes) {
      if (d.resolutionDecision === 'favor_payer') {
        payerWins += 1;
      } else if (d.resolutionDecision === 'favor_freelancer') {
        freelancerWins += 1;
      }
    }

    const totalDecisions = payerWins + freelancerWins;
    const winRateByParty = {
      payer: totalDecisions > 0 ? payerWins / totalDecisions : 0,
      freelancer: totalDecisions > 0 ? freelancerWins / totalDecisions : 0,
    };

    // Common reasons
    const commonDisputeReasons: Record<DisputeReasonCategory, number> = {
      quality: 0,
      timing: 0,
      amount: 0,
      other: 0,
    };

    for (const d of disputes) {
      if (d.reasonCategory in commonDisputeReasons) {
        commonDisputeReasons[d.reasonCategory] += 1;
      } else {
        commonDisputeReasons.other += 1;
      }
    }

    return {
      totalDisputes,
      disputeRateByPayer,
      averageResolutionTimeSeconds,
      winRateByParty,
      commonDisputeReasons,
    };
  }
}
