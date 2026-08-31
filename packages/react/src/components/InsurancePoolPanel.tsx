import React, { useState } from 'react';
import { useLPCoverage, usePoolBalance, useEnroll, useDepositPremium } from '../hooks/useInsurance';
import { useInvoices } from '../hooks/useInvoices';
import { StatsCard } from './StatsCard';

export interface InsurancePoolPanelProps {
  address: string;
  className?: string;
  style?: React.CSSProperties;
}

function formatCurrency(value: bigint | undefined): string {
  if (value === null || value === undefined) return '$0.00';
  return `$${(Number(value) / 10_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(value: number | undefined): string {
  if (value === null || value === undefined) return '0%';
  return `${(value / 100).toFixed(2)}%`;
}

const PANEL_BG = '#FCF7F0';
const PANEL = '#FFFDF9';
const PANEL_ALT = '#F6EFE7';
const BORDER = '#E7DCCF';
const TEXT = '#1F2937';
const MUTED = '#5B6370';
const POSITIVE = '#15803D';
const WARNING = '#B45309';
const DANGER = '#B91C1C';
const ACCENT = '#8B5E34';

export function InsurancePoolPanel({ address, className, style }: InsurancePoolPanelProps) {
  const {
    data: coverage,
    isLoading: coverageLoading,
    error: coverageError,
  } = useLPCoverage(address);
  const { data: poolBalance } = usePoolBalance();
  const { data: invoices } = useInvoices(address, { role: 'lp' });
  const { enroll, isPending: enrolling, error: enrollError, reset: resetEnroll } = useEnroll();
  const {
    depositPremium,
    isPending: depositing,
    error: depositError,
    reset: resetDeposit,
  } = useDepositPremium();

  const [showEnrollForm, setShowEnrollForm] = useState(false);
  const [showPremiumForm, setShowPremiumForm] = useState(false);
  const [coverageAmount, setCoverageAmount] = useState('');
  const [premiumRate, setPremiumRate] = useState('500');
  const [premiumAmount, setPremiumAmount] = useState('');

  const isEnrolled = !!coverage;
  const eligibleCount = invoices?.filter((inv) => inv.status === 'Defaulted').length ?? 0;

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enroll({
        lp: address,
        coverageAmount: BigInt(Math.round(parseFloat(coverageAmount) * 10_000_000)),
        premiumRateBps: parseInt(premiumRate, 10),
      });
      setShowEnrollForm(false);
      resetEnroll();
    } catch {
      // surfaced via useEnroll's own error state
    }
  };

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await depositPremium({
        lp: address,
        amount: BigInt(Math.round(parseFloat(premiumAmount) * 10_000_000)),
      });
      setShowPremiumForm(false);
      resetDeposit();
    } catch {
      // surfaced via useDepositPremium's own error state
    }
  };

  return (
    <section
      className={className}
      style={{
        borderRadius: 28,
        border: `1px solid ${BORDER}`,
        background: PANEL_BG,
        padding: 24,
        color: TEXT,
        fontFamily: '"Manrope", "Segoe UI", sans-serif',
        ...style,
      }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: ACCENT,
          fontWeight: 800,
          marginBottom: 8,
        }}
      >
        Insurance Pool
      </div>
      <h2
        style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: 'clamp(1.6rem, 3vw, 2.4rem)',
          lineHeight: 1.1,
          margin: '0 0 8px 0',
        }}
      >
        LP Coverage & Claims
      </h2>
      <p
        style={{ margin: '0 0 20px 0', maxWidth: 600, color: MUTED, fontSize: 14, lineHeight: 1.6 }}
      >
        Enroll in the insurance pool to protect your funded positions against payer defaults.
        Premiums are paid periodically and claims are reviewed by the pool admin.
      </p>

      {!isEnrolled && !coverageLoading && (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 18,
            border: `1px dashed ${BORDER}`,
            background: PANEL,
          }}
        >
          <p style={{ margin: '0 0 12px 0', fontWeight: 600 }}>
            You are not enrolled in the insurance pool.
          </p>
          {showEnrollForm ? (
            <form
              onSubmit={handleEnroll}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div>
                <label
                  htmlFor="coverage-amount"
                  style={{ display: 'block', fontSize: 12, color: MUTED, marginBottom: 4 }}
                >
                  Coverage Amount (USD)
                </label>
                <input
                  id="coverage-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={coverageAmount}
                  onChange={(e) => setCoverageAmount(e.target.value)}
                  required
                  style={inputStyle}
                  placeholder="e.g. 10000"
                />
              </div>
              <div>
                <label
                  htmlFor="premium-rate"
                  style={{ display: 'block', fontSize: 12, color: MUTED, marginBottom: 4 }}
                >
                  Premium Rate (bps, e.g. 500 = 5%)
                </label>
                <input
                  id="premium-rate"
                  type="number"
                  min="1"
                  max="10000"
                  value={premiumRate}
                  onChange={(e) => setPremiumRate(e.target.value)}
                  required
                  style={inputStyle}
                />
              </div>
              {enrollError && (
                <p role="alert" style={{ color: DANGER, fontSize: 13, margin: 0 }}>
                  {enrollError.message}
                </p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="submit"
                  disabled={enrolling}
                  style={{ ...btnStyle, background: ACCENT, color: '#fff' }}
                >
                  {enrolling ? 'Enrolling…' : 'Enroll'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEnrollForm(false)}
                  style={{ ...btnStyle, background: PANEL_ALT, color: TEXT }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowEnrollForm(true)}
              style={{ ...btnStyle, background: ACCENT, color: '#fff' }}
            >
              Enroll Now
            </button>
          )}
        </div>
      )}

      {coverageLoading && (
        <div style={{ padding: 16, color: MUTED }}>Loading coverage information…</div>
      )}

      {coverageError && (
        <div
          role="alert"
          style={{
            marginBottom: 20,
            padding: '12px 16px',
            borderRadius: 18,
            border: `1px solid #FCA5A5`,
            background: '#FEF2F2',
            color: DANGER,
            fontWeight: 600,
          }}
        >
          Failed to load coverage: {coverageError.message}
        </div>
      )}

      {isEnrolled && coverage && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            }}
          >
            <StatsCard
              title="Coverage Amount"
              value={formatCurrency(coverage.coverageAmount)}
              accentColor={ACCENT}
              style={{ background: PANEL }}
            />
            <StatsCard
              title="Premium Rate"
              value={formatPercent(coverage.premiumRateBps)}
              accentColor={ACCENT}
              style={{ background: PANEL }}
            />
            <StatsCard
              title="Premiums Paid"
              value={formatCurrency(coverage.totalPremiumsPaid)}
              accentColor={ACCENT}
              style={{ background: PANEL }}
            />
            <StatsCard
              title="Total Payout Received"
              value={formatCurrency(coverage.totalPayoutReceived)}
              accentColor={POSITIVE}
              style={{ background: PANEL }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 14,
                background: PANEL_ALT,
                border: `1px solid ${BORDER}`,
              }}
            >
              <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>Active Claims</span>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: coverage.activeClaims > 0 ? WARNING : TEXT,
                }}
              >
                {coverage.activeClaims}
              </div>
            </div>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 14,
                background: PANEL_ALT,
                border: `1px solid ${BORDER}`,
              }}
            >
              <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>Approved</span>
              <div style={{ fontSize: 22, fontWeight: 700, color: POSITIVE }}>
                {coverage.claimsApproved}
              </div>
            </div>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 14,
                background: PANEL_ALT,
                border: `1px solid ${BORDER}`,
              }}
            >
              <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>Rejected</span>
              <div style={{ fontSize: 22, fontWeight: 700, color: DANGER }}>
                {coverage.claimsRejected}
              </div>
            </div>
          </div>

          {showPremiumForm ? (
            <form
              onSubmit={handleDeposit}
              style={{
                padding: 16,
                borderRadius: 18,
                border: `1px solid ${BORDER}`,
                background: PANEL,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div>
                <label
                  htmlFor="premium-amount"
                  style={{ display: 'block', fontSize: 12, color: MUTED, marginBottom: 4 }}
                >
                  Premium Amount (USD)
                </label>
                <input
                  id="premium-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={premiumAmount}
                  onChange={(e) => setPremiumAmount(e.target.value)}
                  required
                  style={inputStyle}
                  placeholder="e.g. 500"
                />
              </div>
              {depositError && (
                <p role="alert" style={{ color: DANGER, fontSize: 13, margin: 0 }}>
                  {depositError.message}
                </p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="submit"
                  disabled={depositing}
                  style={{ ...btnStyle, background: POSITIVE, color: '#fff' }}
                >
                  {depositing ? 'Depositing…' : 'Deposit Premium'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPremiumForm(false)}
                  style={{ ...btnStyle, background: PANEL_ALT, color: TEXT }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowPremiumForm(true)}
              style={{ ...btnStyle, background: POSITIVE, color: '#fff', alignSelf: 'flex-start' }}
            >
              Deposit Premium
            </button>
          )}

          <div
            style={{
              marginTop: 8,
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <div
              style={{
                padding: 14,
                borderRadius: 18,
                border: `1px solid ${BORDER}`,
                background: PANEL,
              }}
            >
              <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 4 }}>
                Defaulted Invoices
              </div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{eligibleCount}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>Eligible for claims</div>
            </div>
            {poolBalance && (
              <>
                <div
                  style={{
                    padding: 14,
                    borderRadius: 18,
                    border: `1px solid ${BORDER}`,
                    background: PANEL,
                  }}
                >
                  <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 4 }}>
                    Pool Reserve
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {formatCurrency(poolBalance.reserveBalance)}
                  </div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
                    {poolBalance.enrolledLps} LPs enrolled
                  </div>
                </div>
                <div
                  style={{
                    padding: 14,
                    borderRadius: 18,
                    border: `1px solid ${BORDER}`,
                    background: PANEL,
                  }}
                >
                  <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 4 }}>
                    Pending Claims
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: poolBalance.pendingClaims > 0 ? WARNING : TEXT,
                    }}
                  >
                    {poolBalance.pendingClaims}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {!isEnrolled && !coverageLoading && !coverageError && (
        <div
          style={{
            padding: 18,
            borderRadius: 18,
            border: `1px dashed ${BORDER}`,
            background: PANEL,
            color: MUTED,
            textAlign: 'center',
          }}
        >
          Connect your wallet and enroll to view coverage details.
        </div>
      )}
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 12,
  border: `1px solid ${BORDER}`,
  fontSize: 14,
  background: '#fff',
  color: TEXT,
  boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 14,
  border: 'none',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
};
