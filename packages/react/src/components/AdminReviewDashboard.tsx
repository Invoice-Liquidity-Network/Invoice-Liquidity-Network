import React, { useState } from 'react';
import { useClaimsList, useReviewClaim } from '../hooks/useInsurance';
import { usePoolBalance } from '../hooks/useInsurance';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { AddressDisplay } from './AddressDisplay';

export interface AdminReviewDashboardProps {
  adminAddress: string;
  className?: string;
  style?: React.CSSProperties;
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

type TabFilter = 'all' | 'Pending' | 'Approved' | 'Rejected';

function formatCurrency(value: bigint | undefined | null): string {
  if (value == null) return '$0.00';
  return `$${(Number(value) / 10_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTimestamp(ts: number | null | undefined): string {
  if (ts == null) return '—';
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdminReviewDashboard({ adminAddress, className, style }: AdminReviewDashboardProps): JSX.Element {
  const [tab, setTab] = useState<TabFilter>('Pending');
  const [rejectionModal, setRejectionModal] = useState<{ claimId: bigint } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const dialogRef = useFocusTrap(rejectionModal != null);

  const statusFilter = tab === 'all' ? undefined : tab;
  const { data: claims, isLoading, error: listError } = useClaimsList(statusFilter);
  const { data: poolBalance } = usePoolBalance();
  const { reviewClaim, isPending: reviewing } = useReviewClaim();

  const handleApprove = async (claimId: bigint) => {
    try {
      await reviewClaim({ reviewer: adminAddress, claimId, approve: true });
    } catch { }
  };

  const handleReject = async () => {
    if (!rejectionModal) return;
    try {
      await reviewClaim({
        reviewer: adminAddress,
        claimId: rejectionModal.claimId,
        approve: false,
        reason: rejectionReason || undefined,
      });
      setRejectionModal(null);
      setRejectionReason('');
    } catch { }
  };

  const tabs: { key: TabFilter; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'Pending', label: 'Pending' },
    { key: 'Approved', label: 'Approved' },
    { key: 'Rejected', label: 'Rejected' },
  ];

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
      <div style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: ACCENT, fontWeight: 800, marginBottom: 8 }}>
        Admin Review
      </div>
      <h2 style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', lineHeight: 1.1, margin: '0 0 6px 0' }}>
        Claims Review Dashboard
      </h2>
      <p style={{ margin: '0 0 20px 0', color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
        Review, approve, or reject insurance claims filed by LPs. Approved claims are paid from the pool reserve.
      </p>

      {poolBalance && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ padding: '12px 16px', borderRadius: 14, background: PANEL, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Pool Reserve</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{formatCurrency(poolBalance.reserveBalance)}</div>
          </div>
          <div style={{ padding: '12px 16px', borderRadius: 14, background: PANEL, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Total Premiums</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{formatCurrency(poolBalance.totalPremiums)}</div>
          </div>
          <div style={{ padding: '12px 16px', borderRadius: 14, background: PANEL, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Total Payouts</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{formatCurrency(poolBalance.totalPayouts)}</div>
          </div>
          <div style={{ padding: '12px 16px', borderRadius: 14, background: PANEL, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Enrolled LPs</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{poolBalance.enrolledLps}</div>
          </div>
        </div>
      )}

      <div role="tablist" aria-label="Claim status filter" style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${BORDER}`, paddingBottom: 12 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 18px',
              borderRadius: 20,
              border: 'none',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              background: tab === t.key ? ACCENT : PANEL_ALT,
              color: tab === t.key ? '#fff' : MUTED,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {listError && (
        <div role="alert" style={{ padding: '12px 16px', borderRadius: 18, border: `1px solid #FCA5A5`, background: '#FEF2F2', color: DANGER, fontWeight: 600, marginBottom: 16 }}>
          Failed to load claims: {listError.message}
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {isLoading && (
          <div style={{ padding: 24, textAlign: 'center', color: MUTED }}>Loading claims…</div>
        )}

        {!isLoading && !listError && claims?.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: MUTED, borderRadius: 18, border: `1px dashed ${BORDER}`, background: PANEL }}>
            No {tab === 'all' ? '' : tab.toLowerCase()} claims to review.
          </div>
        )}

        {claims?.map((claim) => (
          <div
            key={String(claim.id)}
            style={{
              padding: 16,
              borderRadius: 18,
              border: `1px solid ${BORDER}`,
              background: PANEL,
              display: 'grid',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  Claim #{String(claim.id)} — Invoice #{String(claim.invoiceId)}
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                  Filed by <AddressDisplay address={claim.lp} copyable={false} /> on {formatTimestamp(claim.filedAt)}
                </div>
              </div>
              <StatusBadge status={claim.status} />
            </div>

            <div style={{ fontSize: 13, color: TEXT, background: PANEL_ALT, padding: '10px 12px', borderRadius: 12 }}>
              <strong>Reason:</strong> {claim.reason}
            </div>

            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: MUTED, flexWrap: 'wrap' }}>
              <span>Amount: <strong style={{ color: TEXT }}>{formatCurrency(claim.invoiceAmount)}</strong></span>
              {claim.payoutAmount != null && (
                <span>Payout: <strong style={{ color: POSITIVE }}>{formatCurrency(claim.payoutAmount)}</strong></span>
              )}
              {claim.reviewedAt != null && (
                <span>Reviewed: {formatTimestamp(claim.reviewedAt)}</span>
              )}
              {claim.rejectionReason && (
                <span>Reason: <strong style={{ color: DANGER }}>{claim.rejectionReason}</strong></span>
              )}
            </div>

            {claim.status === 'Pending' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => handleApprove(claim.id)}
                  disabled={reviewing}
                  style={{
                    padding: '8px 20px',
                    borderRadius: 12,
                    border: 'none',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: reviewing ? 'not-allowed' : 'pointer',
                    background: POSITIVE,
                    color: '#fff',
                  }}
                >
                  {reviewing ? 'Processing…' : 'Approve'}
                </button>
                <button
                  onClick={() => setRejectionModal({ claimId: claim.id })}
                  disabled={reviewing}
                  style={{
                    padding: '8px 20px',
                    borderRadius: 12,
                    border: 'none',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: reviewing ? 'not-allowed' : 'pointer',
                    background: DANGER,
                    color: '#fff',
                  }}
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {rejectionModal && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Reject claim"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setRejectionModal(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRejectionModal(null);
          }}
        >
          <div
            style={{
              background: PANEL,
              borderRadius: 24,
              padding: 24,
              maxWidth: 440,
              width: '90%',
              border: `1px solid ${BORDER}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="rejection-modal-title" style={{ margin: '0 0 12px 0', fontFamily: '"Newsreader", Georgia, serif' }}>Reject Claim #{String(rejectionModal.claimId)}</h3>
            <label htmlFor="rejection-reason" style={{ display: 'block', fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 6 }}>
              Reason for rejection
            </label>
            <textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Reason for rejection (optional)"
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                fontSize: 14,
                resize: 'vertical',
                minHeight: 70,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRejectionModal(null)}
                style={{
                  padding: '8px 18px',
                  borderRadius: 12,
                  border: `1px solid ${BORDER}`,
                  background: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={reviewing}
                style={{
                  padding: '8px 18px',
                  borderRadius: 12,
                  border: 'none',
                  fontWeight: 700,
                  cursor: reviewing ? 'not-allowed' : 'pointer',
                  background: DANGER,
                  color: '#fff',
                }}
              >
                {reviewing ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const colors: Record<string, { bg: string; text: string }> = {
    Pending: { bg: '#FEF3C7', text: '#92400E' },
    Approved: { bg: '#DCFCE7', text: '#166534' },
    Rejected: { bg: '#FEE2E2', text: '#991B1B' },
  };
  const c = colors[status] ?? { bg: PANEL_ALT, text: MUTED };

  return (
    <span
      style={{
        padding: '4px 12px',
        borderRadius: 12,
        background: c.bg,
        color: c.text,
        fontWeight: 700,
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}
