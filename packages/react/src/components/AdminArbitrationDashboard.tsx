import React, { useState } from 'react';
import type { DisputeRecord, DisputeStatus, DisputeResolutionDecision } from '@iln/shared';
import { useDisputeList, useResolveDispute } from '../hooks/useDispute';
import { AddressDisplay } from './AddressDisplay';
import { EvidenceViewer } from './EvidenceViewer';
import { AutoResolveCountdown } from './AutoResolveCountdown';

export interface AdminArbitrationDashboardProps {
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
const DANGER = '#B91C1C';
const ACCENT = '#8B5E34';

type DisputeTabFilter = 'all' | 'Pending' | 'ResolvedFavorFreelancer' | 'ResolvedFavorPayer' | 'AutoResolvedFavorFreelancer';

function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdminArbitrationDashboard({
  adminAddress,
  className,
  style,
}: AdminArbitrationDashboardProps) {
  const [tab, setTab] = useState<DisputeTabFilter>('Pending');
  const [selectedDispute, setSelectedDispute] = useState<DisputeRecord | null>(null);
  const [decision, setDecision] = useState<DisputeResolutionDecision>('favor_freelancer');
  const [notes, setNotes] = useState('');

  const statusFilter = tab === 'all' ? undefined : (tab as DisputeStatus);
  const { data: disputes, isLoading, error: listError } = useDisputeList(statusFilter);
  const { resolveDispute, isPending: resolving, error: resolveError } = useResolveDispute();

  const handleExecuteResolution = async (invoiceId: bigint) => {
    try {
      await resolveDispute({
        admin: adminAddress,
        invoiceId,
        decision,
        notes: notes || undefined,
      });
      setSelectedDispute(null);
      setNotes('');
    } catch {
      // Surfaced via error state
    }
  };

  const tabs: { key: DisputeTabFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'Pending', label: 'Pending Arbitration' },
    { key: 'ResolvedFavorFreelancer', label: 'Favored Freelancer' },
    { key: 'ResolvedFavorPayer', label: 'Favored Payer' },
    { key: 'AutoResolvedFavorFreelancer', label: 'Auto-Resolved' },
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
        Arbitration Dashboard
      </div>
      <h2
        style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: 'clamp(1.6rem, 3vw, 2.4rem)',
          lineHeight: 1.1,
          margin: '0 0 6px 0',
        }}
      >
        Dispute Resolution & Arbitration
      </h2>
      <p style={{ margin: '0 0 20px 0', color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
        Review submitted evidence from payers and freelancers, adjudicate disputes, and execute on-chain settlements.
      </p>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Filter disputes by status"
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}
      >
        {tabs.map(({ key, label }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              style={{
                borderRadius: 9999,
                border: active ? `1.5px solid ${ACCENT}` : `1px solid ${BORDER}`,
                background: active ? ACCENT : PANEL,
                color: active ? '#FFF' : TEXT,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {listError && (
        <div style={{ padding: 12, background: '#FEF2F2', color: DANGER, borderRadius: 12, fontSize: 13, marginBottom: 16 }}>
          Failed to load disputes: {listError.message}
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: 32, textAlign: 'center', color: MUTED, fontSize: 13 }}>
          Loading dispute records...
        </div>
      ) : !disputes || disputes.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            background: PANEL,
            border: `1px solid ${BORDER}`,
            borderRadius: 20,
            color: MUTED,
            fontSize: 13,
          }}
        >
          No disputes matching the selected filter.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selectedDispute ? '1fr 1fr' : '1fr', gap: 16 }}>
          {/* Dispute list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {disputes.map((dispute) => {
              const isSelected = selectedDispute?.invoiceId === dispute.invoiceId;
              const isPending = dispute.status === 'Pending';

              return (
                <div
                  key={String(dispute.invoiceId)}
                  data-testid={`dispute-row-${String(dispute.invoiceId)}`}
                  onClick={() => setSelectedDispute(dispute)}
                  style={{
                    padding: 16,
                    borderRadius: 18,
                    border: `1px solid ${isSelected ? ACCENT : BORDER}`,
                    background: isSelected ? PANEL_ALT : PANEL,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>
                      Invoice #{String(dispute.invoiceId)}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: isPending ? '#FFEDD5' : '#ECFDF5',
                        color: isPending ? '#9A3412' : '#065F46',
                      }}
                    >
                      {dispute.status}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: MUTED, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span>Disputer: <AddressDisplay address={dispute.disputer} /></span>
                    <span>Category: <strong>{dispute.reasonCategory}</strong></span>
                    <span>Filed: {formatTimestamp(dispute.filedAt)}</span>
                  </div>

                  <p style={{ margin: 0, fontSize: 13, color: TEXT, lineHeight: 1.4 }}>
                    {dispute.reasonDescription}
                  </p>

                  {isPending && (
                    <AutoResolveCountdown autoResolveAt={dispute.autoResolveAt} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Details & Arbitration Decision Panel */}
          {selectedDispute && (
            <div
              data-testid="arbitration-detail-panel"
              style={{
                padding: 20,
                borderRadius: 20,
                border: `1px solid ${BORDER}`,
                background: PANEL,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                  Arbitration: Invoice #{String(selectedDispute.invoiceId)}
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedDispute(null)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: MUTED }}
                >
                  ✕ Close
                </button>
              </div>

              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: 12, textTransform: 'uppercase', color: ACCENT }}>
                  Submitted Evidence ({selectedDispute.evidence?.length || 0})
                </h4>
                <EvidenceViewer evidence={selectedDispute.evidence || []} />
              </div>

              {selectedDispute.status === 'Pending' ? (
                <div
                  style={{
                    padding: 16,
                    background: PANEL_ALT,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>
                    Adjudication Decision
                  </h4>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <label
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${decision === 'favor_freelancer' ? POSITIVE : BORDER}`,
                        background: decision === 'favor_freelancer' ? '#ECFDF5' : PANEL,
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <input
                        type="radio"
                        name="arbitrationDecision"
                        value="favor_freelancer"
                        checked={decision === 'favor_freelancer'}
                        onChange={() => setDecision('favor_freelancer')}
                        style={{ accentColor: POSITIVE }}
                      />
                      Favor Freelancer (Release Payout)
                    </label>

                    <label
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${decision === 'favor_payer' ? DANGER : BORDER}`,
                        background: decision === 'favor_payer' ? '#FEF2F2' : PANEL,
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <input
                        type="radio"
                        name="arbitrationDecision"
                        value="favor_payer"
                        checked={decision === 'favor_payer'}
                        onChange={() => setDecision('favor_payer')}
                        style={{ accentColor: DANGER }}
                      />
                      Favor Payer (Cancel / Refund)
                    </label>
                  </div>

                  <div>
                    <label
                      htmlFor="arbitration-notes"
                      style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4 }}
                    >
                      Arbitration Memo / Notes
                    </label>
                    <textarea
                      id="arbitration-notes"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Explain findings from evidence verification..."
                      style={{
                        width: '100%',
                        padding: 8,
                        borderRadius: 8,
                        border: `1px solid ${BORDER}`,
                        fontSize: 12,
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {resolveError && (
                    <div style={{ color: DANGER, fontSize: 12 }}>
                      Error: {resolveError.message}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleExecuteResolution(selectedDispute.invoiceId)}
                    disabled={resolving}
                    style={{
                      padding: '10px 18px',
                      background: decision === 'favor_freelancer' ? POSITIVE : DANGER,
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: 12,
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: resolving ? 'not-allowed' : 'pointer',
                      opacity: resolving ? 0.7 : 1,
                    }}
                  >
                    {resolving ? 'Executing Arbitration...' : 'Execute Resolution On-Chain'}
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    padding: 14,
                    background: PANEL_ALT,
                    borderRadius: 12,
                    fontSize: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div>
                    <strong>Resolution:</strong> {selectedDispute.resolutionDecision}
                  </div>
                  <div>
                    <strong>Resolved By:</strong> <AddressDisplay address={selectedDispute.resolvedBy ?? ''} />
                  </div>
                  <div>
                    <strong>Resolved At:</strong> {formatTimestamp(selectedDispute.resolvedAt)}
                  </div>
                  {selectedDispute.resolutionNotes && (
                    <div>
                      <strong>Notes:</strong> {selectedDispute.resolutionNotes}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
