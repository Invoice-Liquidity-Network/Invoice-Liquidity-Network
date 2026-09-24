import { describe, it, expect } from 'vitest';
import * as StellarSdk from '@stellar/stellar-sdk';
import { OracleVerifier } from '@iln/oracle-service';
import { MockKYBProvider } from '../../oracle-service/src/kyb/mockProvider';
import type {
  IndexerInvoiceHistoryEntry,
  ReputationSnapshot,
  OracleVerificationRequest,
} from '../../oracle-service/src/types';

describe('E2E Cross-Package Integration: Oracle Service & Fraud Heuristics (#865)', () => {
  const payerKeypair = StellarSdk.Keypair.random();
  const payerAddress = payerKeypair.publicKey();

  const nowMs = 1_700_500_000_000;
  const dayMs = 24 * 60 * 60 * 1000;

  // ── Scenario 1: Standard Verified Payer Gates Successful Invoice Funding ──────
  describe('Standard Flow: Verified Payer Invoice Funding Gate', () => {
    it('approves funding gate when oracle returns isVerified: true for healthy history', async () => {
      const healthyHistory: IndexerInvoiceHistoryEntry[] = [
        {
          id: 101,
          freelancer: 'G_FREELANCER_1',
          payer: payerAddress,
          amount: '10000000',
          due_date: Math.floor((nowMs - 20 * dayMs) / 1000),
          discount_rate: 300,
          status: 'Paid',
          funder: 'G_LP_1',
          funded_at: Math.floor((nowMs - 20 * dayMs) / 1000),
          created_at: nowMs - 25 * dayMs,
          updated_at: nowMs - 15 * dayMs,
        },
        {
          id: 102,
          freelancer: 'G_FREELANCER_2',
          payer: payerAddress,
          amount: '15000000',
          due_date: Math.floor((nowMs - 10 * dayMs) / 1000),
          discount_rate: 300,
          status: 'Paid',
          funder: 'G_LP_2',
          funded_at: Math.floor((nowMs - 10 * dayMs) / 1000),
          created_at: nowMs - 12 * dayMs,
          updated_at: nowMs - 5 * dayMs,
        },
      ];

      const reputation: ReputationSnapshot = {
        address: payerAddress,
        score: 88,
        totalPaid: 25_000_000n,
        invoiceCount: 2,
        lastActivity: Math.floor((nowMs - 5 * dayMs) / 1000),
        rank: 2,
      };

      const verifier = new OracleVerifier({
        historyProvider: async () => healthyHistory,
        reputationProvider: async () => reputation,
        now: () => nowMs,
        maxOracleAgeMs: 10 * dayMs,
      });

      const invoiceRequest: OracleVerificationRequest = {
        payer: payerAddress,
        amount: '12000000',
        invoiceId: '201',
      };

      // 1. Oracle assessment step
      const oracleAssessment = await verifier.verify(invoiceRequest);

      expect(oracleAssessment.isVerified).toBe(true);
      expect(oracleAssessment.trustScore).toBeGreaterThanOrEqual(70);
      expect(oracleAssessment.confidence).toBeGreaterThanOrEqual(0.55);
      expect(oracleAssessment.fraudSignals).toHaveLength(0);

      // 2. Simulated gating function in funding flow:
      // If require_oracle_verification is true, only proceed if isVerified === true
      const canFundInvoice = (reqOracle: boolean, assessment: typeof oracleAssessment) => {
        if (!reqOracle) return true;
        return assessment.isVerified;
      };

      expect(canFundInvoice(true, oracleAssessment)).toBe(true);
    });
  });

  // ── Scenario 2: Fraud Heuristics — Rapid Succession Abuse ──────────────────
  describe('Fraud Heuristics: Rapid Succession Abuse Detection', () => {
    it('flags rapid successive invoice creation from same payer and blocks funding', async () => {
      const abusivePayer = StellarSdk.Keypair.random().publicKey();

      // 3 invoices submitted in rapid succession within 24 hours
      const rapidHistory: IndexerInvoiceHistoryEntry[] = [
        {
          id: 301,
          freelancer: 'G_FREELANCER_A',
          payer: abusivePayer,
          amount: '5000000',
          due_date: Math.floor(nowMs / 1000) + 86400,
          discount_rate: 300,
          status: 'Pending',
          created_at: nowMs - 2 * 60 * 60 * 1000, // 2 hours ago
          updated_at: nowMs - 2 * 60 * 60 * 1000,
        },
        {
          id: 302,
          freelancer: 'G_FREELANCER_B',
          payer: abusivePayer,
          amount: '5000000',
          due_date: Math.floor(nowMs / 1000) + 86400,
          discount_rate: 300,
          status: 'Pending',
          created_at: nowMs - 4 * 60 * 60 * 1000, // 4 hours ago
          updated_at: nowMs - 4 * 60 * 60 * 1000,
        },
        {
          id: 303,
          freelancer: 'G_FREELANCER_C',
          payer: abusivePayer,
          amount: '5000000',
          due_date: Math.floor(nowMs / 1000) + 86400,
          discount_rate: 300,
          status: 'Pending',
          created_at: nowMs - 6 * 60 * 60 * 1000, // 6 hours ago
          updated_at: nowMs - 6 * 60 * 60 * 1000,
        },
      ];

      const reputation: ReputationSnapshot = {
        address: abusivePayer,
        score: 30,
        totalPaid: 0n,
        invoiceCount: 3,
        lastActivity: Math.floor((nowMs - 2 * 60 * 60 * 1000) / 1000),
        rank: 0,
      };

      const verifier = new OracleVerifier({
        historyProvider: async () => rapidHistory,
        reputationProvider: async () => reputation,
        now: () => nowMs,
      });

      const burstRequest: OracleVerificationRequest = {
        payer: abusivePayer,
        amount: '5000000',
        invoiceId: '304',
      };

      const result = await verifier.verify(burstRequest);

      // Fraud heuristic must detect rapid succession pattern
      expect(result.fraudSignals).toContain(
        'Rapid succession of invoices detected for the same payer'
      );
      expect(result.isVerified).toBe(false);

      // Gating check: funding MUST be rejected
      const canFund = (reqOracle: boolean, assessment: typeof result) => {
        if (!reqOracle) return true;
        return assessment.isVerified;
      };

      expect(canFund(true, result)).toBe(false);
    });
  });

  // ── Scenario 3: Fraud Heuristics — Concentrated Defaults ───────────────────
  describe('Fraud Heuristics: Concentrated Defaults', () => {
    it('flags high default concentration in recent history and blocks funding', async () => {
      const defaultedPayer = StellarSdk.Keypair.random().publicKey();

      const defaultHistory: IndexerInvoiceHistoryEntry[] = [
        {
          id: 401,
          freelancer: 'G_FREELANCER_D',
          payer: defaultedPayer,
          amount: '10000000',
          due_date: Math.floor((nowMs - 15 * dayMs) / 1000),
          discount_rate: 300,
          status: 'Defaulted',
          funder: 'G_LP_3',
          funded_at: Math.floor((nowMs - 20 * dayMs) / 1000),
          created_at: nowMs - 25 * dayMs,
          updated_at: nowMs - 14 * dayMs,
        },
        {
          id: 402,
          freelancer: 'G_FREELANCER_E',
          payer: defaultedPayer,
          amount: '12000000',
          due_date: Math.floor((nowMs - 8 * dayMs) / 1000),
          discount_rate: 300,
          status: 'Defaulted',
          funder: 'G_LP_4',
          funded_at: Math.floor((nowMs - 12 * dayMs) / 1000),
          created_at: nowMs - 15 * dayMs,
          updated_at: nowMs - 7 * dayMs,
        },
      ];

      const reputation: ReputationSnapshot = {
        address: defaultedPayer,
        score: 15,
        totalPaid: 0n,
        invoiceCount: 2,
        lastActivity: Math.floor((nowMs - 7 * dayMs) / 1000),
        rank: 0,
      };

      const verifier = new OracleVerifier({
        historyProvider: async () => defaultHistory,
        reputationProvider: async () => reputation,
        now: () => nowMs,
      });

      const result = await verifier.verify({
        payer: defaultedPayer,
        amount: '10000000',
        invoiceId: '403',
      });

      expect(result.fraudSignals).toContain(
        'Recent default concentration suggests elevated fraud risk'
      );
      expect(result.isVerified).toBe(false);
      expect(result.trustScore).toBeLessThan(50);
    });
  });

  // ── Scenario 4: Pluggable KYB Provider Integration Gate ────────────────────
  describe('Pluggable External KYB Provider Gate (#868)', () => {
    it('integrates external KYB entity check into cross-package verification pipeline', async () => {
      const corporatePayer = StellarSdk.Keypair.random().publicKey();

      const kybProvider = new MockKYBProvider({
        knownBusinesses: {
          [corporatePayer]: {
            isVerified: true,
            businessName: 'Stellar Logistics Global Ltd',
            registrationNumber: 'UK-COMP-998822',
            jurisdiction: 'GB',
            riskScore: 8,
          },
        },
      });

      const verifier = new OracleVerifier({
        historyProvider: async () => [
          {
            id: 501,
            freelancer: 'G_DEV_1',
            payer: corporatePayer,
            amount: '20000000',
            due_date: Math.floor((nowMs - 10 * dayMs) / 1000),
            discount_rate: 250,
            status: 'Paid',
            funder: 'G_LP_5',
            funded_at: Math.floor((nowMs - 10 * dayMs) / 1000),
            created_at: nowMs - 15 * dayMs,
            updated_at: nowMs - 9 * dayMs,
          },
          {
            id: 502,
            freelancer: 'G_DEV_2',
            payer: corporatePayer,
            amount: '30000000',
            due_date: Math.floor((nowMs - 5 * dayMs) / 1000),
            discount_rate: 250,
            status: 'Paid',
            funder: 'G_LP_5',
            funded_at: Math.floor((nowMs - 5 * dayMs) / 1000),
            created_at: nowMs - 8 * dayMs,
            updated_at: nowMs - 4 * dayMs,
          },
        ],
        reputationProvider: async () => ({
          address: corporatePayer,
          score: 92,
          totalPaid: 50_000_000n,
          invoiceCount: 2,
          lastActivity: Math.floor((nowMs - 4 * dayMs) / 1000),
          rank: 1,
        }),
        kybProvider,
        now: () => nowMs,
        maxOracleAgeMs: 10 * dayMs,
      });

      const response = await verifier.verify({
        payer: corporatePayer,
        amount: '25000000',
        invoiceId: '503',
      });

      expect(response.isVerified).toBe(true);
      expect(response.kybResult?.isVerified).toBe(true);
      expect(response.kybResult?.businessName).toBe('Stellar Logistics Global Ltd');
      expect(response.evidence).toContain(
        'KYB verification (MockKYBProvider): VERIFIED - Business: Stellar Logistics Global Ltd'
      );
    });
  });
});
