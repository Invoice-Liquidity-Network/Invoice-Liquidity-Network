import { describe, it, expect } from 'vitest';
import {
  DisputeStateMachine,
  DEFAULT_EVIDENCE_PERIOD_SECONDS,
  DEFAULT_AUTO_RESOLVE_PERIOD_SECONDS,
} from './state-machine';
import type { Invoice } from '@iln/shared';

const PAYER_1 = 'GDHK...PAYER1';
const FREELANCER_1 = 'GA7T...FREELANCER1';
const STRANGER = 'GCXX...STRANGER';
const ADMIN = 'GBBB...ADMIN';

function createMockInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 101n,
    freelancer: FREELANCER_1,
    payer: PAYER_1,
    token: 'CDLZ...USDC',
    amount: 10_000_000n,
    dueDate: 1700000000,
    discountRate: 300,
    status: 'Funded',
    funder: 'GCLP...LP1',
    fundedAt: 1699000000,
    amountFunded: 10_000_000n,
    amountPaid: 0n,
    submitterReputation: 100,
    referralCode: null,
    allowedLps: null,
    isAuction: false,
    auctionStartRate: null,
    auctionMinRate: null,
    auctionRateDecayPerHour: null,
    auctionStartedAt: null,
    ...overrides,
  };
}

describe('DisputeStateMachine', () => {
  describe('canDispute and fileDispute', () => {
    it('allows payer to dispute a Funded invoice', () => {
      const invoice = createMockInvoice({ status: 'Funded' });
      const check = DisputeStateMachine.canDispute(invoice, PAYER_1);
      expect(check.allowed).toBe(true);

      const now = 1700000100;
      const { dispute, nextInvoiceStatus } = DisputeStateMachine.fileDispute({
        invoice,
        disputer: PAYER_1,
        reasonCategory: 'quality',
        reasonDescription: 'Work deliverable does not match specifications.',
        evidenceCid: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        now,
      });

      expect(nextInvoiceStatus).toBe('Disputed');
      expect(dispute.invoiceId).toBe(101n);
      expect(dispute.disputer).toBe(PAYER_1);
      expect(dispute.status).toBe('Pending');
      expect(dispute.evidenceDeadline).toBe(now + DEFAULT_EVIDENCE_PERIOD_SECONDS);
      expect(dispute.autoResolveAt).toBe(now + DEFAULT_AUTO_RESOLVE_PERIOD_SECONDS);
      expect(dispute.evidence).toHaveLength(1);
      expect(dispute.evidence[0].submitter).toBe(PAYER_1);
      expect(dispute.evidence[0].role).toBe('payer');
    });

    it('allows freelancer to dispute a PartiallyFunded invoice', () => {
      const invoice = createMockInvoice({ status: 'PartiallyFunded' });
      const check = DisputeStateMachine.canDispute(invoice, FREELANCER_1);
      expect(check.allowed).toBe(true);

      const { nextInvoiceStatus } = DisputeStateMachine.fileDispute({
        invoice,
        disputer: FREELANCER_1,
        reasonCategory: 'timing',
        reasonDescription: 'Funding timeline breached',
        evidenceCid: 'ipfs://bafybeifreelancer123',
      });
      expect(nextInvoiceStatus).toBe('Disputed');
    });

    it('rejects dispute on Paid, Defaulted, or Cancelled invoices', () => {
      const paidInvoice = createMockInvoice({ status: 'Paid' });
      expect(DisputeStateMachine.canDispute(paidInvoice, PAYER_1).allowed).toBe(false);

      const defaultedInvoice = createMockInvoice({ status: 'Defaulted' });
      expect(DisputeStateMachine.canDispute(defaultedInvoice, PAYER_1).allowed).toBe(false);

      const cancelledInvoice = createMockInvoice({ status: 'Cancelled' });
      expect(DisputeStateMachine.canDispute(cancelledInvoice, PAYER_1).allowed).toBe(false);
    });

    it('rejects dispute by unauthorized third party', () => {
      const invoice = createMockInvoice({ status: 'Funded' });
      const check = DisputeStateMachine.canDispute(invoice, STRANGER);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Only invoice payer or freelancer');
    });

    it('throws error when evidence CID is missing', () => {
      const invoice = createMockInvoice({ status: 'Funded' });
      expect(() =>
        DisputeStateMachine.fileDispute({
          invoice,
          disputer: PAYER_1,
          reasonCategory: 'other',
          reasonDescription: 'No proof',
          evidenceCid: '',
        })
      ).toThrow('Evidence CID is required');
    });
  });

  describe('submitEvidence', () => {
    it('allows freelancer and payer to submit supporting evidence before deadline', () => {
      const now = 1700000000;
      const invoice = createMockInvoice();
      const { dispute } = DisputeStateMachine.fileDispute({
        invoice,
        disputer: PAYER_1,
        reasonCategory: 'quality',
        reasonDescription: 'Initial dispute',
        evidenceCid: 'ipfs://payer-cid-1',
        now,
      });

      const updatedDispute = DisputeStateMachine.submitEvidence({
        dispute,
        submitter: FREELANCER_1,
        role: 'freelancer',
        evidenceCid: 'ipfs://freelancer-cid-2',
        description: 'Here are the completed source files and Git commit logs.',
        fileName: 'code_submission.zip',
        fileType: 'application/zip',
        fileSize: 1048576,
        now: now + 86400, // 1 day later
      });

      expect(updatedDispute.evidence).toHaveLength(2);
      expect(updatedDispute.evidence[1].submitter).toBe(FREELANCER_1);
      expect(updatedDispute.evidence[1].role).toBe('freelancer');
      expect(updatedDispute.evidence[1].fileName).toBe('code_submission.zip');
    });

    it('rejects evidence submitted after deadline', () => {
      const now = 1700000000;
      const invoice = createMockInvoice();
      const { dispute } = DisputeStateMachine.fileDispute({
        invoice,
        disputer: PAYER_1,
        reasonCategory: 'amount',
        reasonDescription: 'Incorrect billing',
        evidenceCid: 'ipfs://payer-cid',
        now,
      });

      expect(() =>
        DisputeStateMachine.submitEvidence({
          dispute,
          submitter: FREELANCER_1,
          role: 'freelancer',
          evidenceCid: 'ipfs://freelancer-cid-late',
          description: 'Late evidence',
          now: now + DEFAULT_EVIDENCE_PERIOD_SECONDS + 1, // Past 7 days
        })
      ).toThrow('Evidence submission window closed');
    });

    it('rejects evidence submission once dispute is resolved', () => {
      const invoice = createMockInvoice();
      const { dispute } = DisputeStateMachine.fileDispute({
        invoice,
        disputer: PAYER_1,
        reasonCategory: 'quality',
        reasonDescription: 'Initial',
        evidenceCid: 'ipfs://payer-cid',
      });

      const { dispute: resolvedDispute } = DisputeStateMachine.resolveDispute({
        dispute,
        resolver: ADMIN,
        decision: 'favor_freelancer',
        notes: 'Approved',
      });

      expect(() =>
        DisputeStateMachine.submitEvidence({
          dispute: resolvedDispute,
          submitter: PAYER_1,
          role: 'payer',
          evidenceCid: 'ipfs://payer-after-resolve',
          description: 'Too late',
        })
      ).toThrow('Cannot submit evidence for a dispute with status');
    });
  });

  describe('resolveDispute (Admin Arbitration)', () => {
    it('resolves in favor of freelancer -> transitions invoice to Paid', () => {
      const invoice = createMockInvoice();
      const { dispute } = DisputeStateMachine.fileDispute({
        invoice,
        disputer: PAYER_1,
        reasonCategory: 'quality',
        reasonDescription: 'Quality issue',
        evidenceCid: 'ipfs://payer-cid',
      });

      const { dispute: resolved, nextInvoiceStatus } = DisputeStateMachine.resolveDispute({
        dispute,
        resolver: ADMIN,
        decision: 'favor_freelancer',
        notes: 'Freelancer delivered work according to milestones verified in Git history.',
      });

      expect(resolved.status).toBe('ResolvedFavorFreelancer');
      expect(resolved.resolutionDecision).toBe('favor_freelancer');
      expect(resolved.resolvedBy).toBe(ADMIN);
      expect(resolved.resolutionNotes).toContain('Freelancer delivered work');
      expect(nextInvoiceStatus).toBe('Paid');
    });

    it('resolves in favor of payer -> transitions invoice to Cancelled', () => {
      const invoice = createMockInvoice();
      const { dispute } = DisputeStateMachine.fileDispute({
        invoice,
        disputer: PAYER_1,
        reasonCategory: 'amount',
        reasonDescription: 'Overbilled',
        evidenceCid: 'ipfs://payer-cid',
      });

      const { dispute: resolved, nextInvoiceStatus } = DisputeStateMachine.resolveDispute({
        dispute,
        resolver: ADMIN,
        decision: 'favor_payer',
        notes: 'Payer overbilled by 50%; refund authorized.',
      });

      expect(resolved.status).toBe('ResolvedFavorPayer');
      expect(resolved.resolutionDecision).toBe('favor_payer');
      expect(nextInvoiceStatus).toBe('Cancelled');
    });
  });

  describe('autoResolveDispute (Timeout resolution)', () => {
    it('auto-resolves in favor of freelancer after timeout', () => {
      const now = 1700000000;
      const invoice = createMockInvoice();
      const { dispute } = DisputeStateMachine.fileDispute({
        invoice,
        disputer: PAYER_1,
        reasonCategory: 'timing',
        reasonDescription: 'Late delivery',
        evidenceCid: 'ipfs://payer-cid',
        now,
      });

      const timeoutTimestamp = now + DEFAULT_AUTO_RESOLVE_PERIOD_SECONDS;

      const { dispute: autoResolved, nextInvoiceStatus } = DisputeStateMachine.autoResolveDispute({
        dispute,
        now: timeoutTimestamp + 10,
      });

      expect(autoResolved.status).toBe('AutoResolvedFavorFreelancer');
      expect(autoResolved.resolutionDecision).toBe('favor_freelancer');
      expect(autoResolved.resolvedBy).toBe('system:auto-resolve');
      expect(nextInvoiceStatus).toBe('Paid');
    });

    it('rejects auto-resolution if called before timeout', () => {
      const now = 1700000000;
      const invoice = createMockInvoice();
      const { dispute } = DisputeStateMachine.fileDispute({
        invoice,
        disputer: PAYER_1,
        reasonCategory: 'other',
        reasonDescription: 'Dispute',
        evidenceCid: 'ipfs://payer-cid',
        now,
      });

      expect(() =>
        DisputeStateMachine.autoResolveDispute({
          dispute,
          now: now + 3600, // only 1 hour later
        })
      ).toThrow('Auto-resolution timeout not yet reached');
    });
  });

  describe('Dispute isolation (Non-blocking check)', () => {
    it('disputing invoice A does not affect state or operations on invoice B', () => {
      const invoiceA = createMockInvoice({ id: 101n, status: 'Funded' });
      const invoiceB = createMockInvoice({ id: 102n, status: 'Funded' });

      const { dispute: disputeA, nextInvoiceStatus: statusA } = DisputeStateMachine.fileDispute({
        invoice: invoiceA,
        disputer: PAYER_1,
        reasonCategory: 'quality',
        reasonDescription: 'Dispute on invoice A',
        evidenceCid: 'ipfs://cid-a',
      });

      expect(statusA).toBe('Disputed');
      expect(disputeA.invoiceId).toBe(101n);

      // Invoice B is still Funded and can be checked or paid independently
      expect(invoiceB.status).toBe('Funded');
      expect(invoiceB.id).toBe(102n);
    });
  });

  describe('computeAnalytics', () => {
    it('calculates dispute rate, avg resolution time, win rate, and reason distribution', () => {
      const invoices = [
        createMockInvoice({ id: 1n, payer: PAYER_1 }),
        createMockInvoice({ id: 2n, payer: PAYER_1 }),
        createMockInvoice({ id: 3n, payer: 'OTHER_PAYER' }),
      ];

      const now = 1700000000;
      const dispute1 = DisputeStateMachine.fileDispute({
        invoice: invoices[0],
        disputer: PAYER_1,
        reasonCategory: 'quality',
        reasonDescription: 'Quality issue',
        evidenceCid: 'ipfs://cid-1',
        now,
      }).dispute;

      const dispute2 = DisputeStateMachine.fileDispute({
        invoice: invoices[1],
        disputer: PAYER_1,
        reasonCategory: 'timing',
        reasonDescription: 'Timing issue',
        evidenceCid: 'ipfs://cid-2',
        now,
      }).dispute;

      const resolved1 = DisputeStateMachine.resolveDispute({
        dispute: dispute1,
        resolver: ADMIN,
        decision: 'favor_freelancer',
        now: now + 3600, // resolved in 1 hour
      }).dispute;

      const resolved2 = DisputeStateMachine.resolveDispute({
        dispute: dispute2,
        resolver: ADMIN,
        decision: 'favor_payer',
        now: now + 7200, // resolved in 2 hours
      }).dispute;

      const analytics = DisputeStateMachine.computeAnalytics([resolved1, resolved2], invoices);

      expect(analytics.totalDisputes).toBe(2);
      // Payer 1 had 2 disputes out of 2 invoices -> 1.0
      expect(analytics.disputeRateByPayer[PAYER_1]).toBe(1);
      // Average resolution time: (3600 + 7200) / 2 = 5400 seconds
      expect(analytics.averageResolutionTimeSeconds).toBe(5400);
      // 1 freelancer win, 1 payer win -> 0.5 each
      expect(analytics.winRateByParty.freelancer).toBe(0.5);
      expect(analytics.winRateByParty.payer).toBe(0.5);
      // Reason distribution
      expect(analytics.commonDisputeReasons.quality).toBe(1);
      expect(analytics.commonDisputeReasons.timing).toBe(1);
      expect(analytics.commonDisputeReasons.amount).toBe(0);
      expect(analytics.commonDisputeReasons.other).toBe(0);
    });
  });
});
