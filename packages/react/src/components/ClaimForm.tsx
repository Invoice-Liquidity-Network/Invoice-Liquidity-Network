import React, { useState } from 'react';
import { useSubmitClaim } from '../hooks/useInsurance';
import { useLPCoverage } from '../hooks/useInsurance';
import { useInvoices } from '../hooks/useInvoices';
import { AddressDisplay } from './AddressDisplay';

export interface ClaimFormProps {
  lp: string;
  invoiceId?: bigint;
  className?: string;
  style?: React.CSSProperties;
  onSuccess?: (claimId: bigint) => void;
}

const PANEL = '#FFFDF9';
const PANEL_ALT = '#F6EFE7';
const BORDER = '#E7DCCF';
const TEXT = '#1F2937';
const MUTED = '#5B6370';
const DANGER = '#B91C1C';
const POSITIVE = '#15803D';
const ACCENT = '#8B5E34';

export function ClaimForm({ lp, invoiceId: preselectedId, className, style, onSuccess }: ClaimFormProps): JSX.Element {
  const { data: coverage, isLoading: covLoading } = useLPCoverage(lp);
  const { data: invoices, isLoading: invLoading } = useInvoices(lp, { role: 'issuer' });
  const { submitClaim, isPending, error, reset } = useSubmitClaim();

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(preselectedId ? String(preselectedId) : '');
  const [reason, setReason] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const defaultedInvoices = (invoices ?? []).filter((inv) => inv.status === 'Defaulted');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    try {
      const id = await submitClaim({
        lp,
        invoiceId: BigInt(selectedInvoiceId),
        reason,
      });
      setSuccessMsg(`Claim #${String(id)} submitted successfully.`);
      setReason('');
      reset();
      onSuccess?.(id);
    } catch { }
  };

  const isEligible = coverage != null;
  const hasDefaulted = defaultedInvoices.length > 0;

  return (
    <section
      className={className}
      style={{
        borderRadius: 28,
        border: `1px solid ${BORDER}`,
        background: PANEL,
        padding: 24,
        color: TEXT,
        fontFamily: '"Manrope", "Segoe UI", sans-serif',
        ...style,
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: ACCENT, fontWeight: 800, marginBottom: 8 }}>
        File a Claim
      </div>
      <h2 style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 'clamp(1.4rem, 2.5vw, 2rem)', lineHeight: 1.1, margin: '0 0 6px 0' }}>
        Submit Insurance Claim
      </h2>
      <p style={{ margin: '0 0 20px 0', color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
        File a claim against a defaulted invoice that you funded as an LP.
        The pool admin will review your claim and approve or reject it.
      </p>

      {!isEligible && !covLoading && (
        <div role="alert" style={{ padding: 16, borderRadius: 18, border: `1px solid #FCA5A5`, background: '#FEF2F2', color: DANGER, fontWeight: 600, marginBottom: 16 }}>
          You must enroll in the insurance pool before filing claims.
        </div>
      )}

      {successMsg && (
        <div role="status" style={{ padding: '12px 16px', borderRadius: 18, border: `1px solid #86EFAC`, background: '#F0FDF4', color: POSITIVE, fontWeight: 600, marginBottom: 16 }}>
          {successMsg}
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: '12px 16px', borderRadius: 18, border: `1px solid #FCA5A5`, background: '#FEF2F2', color: DANGER, fontWeight: 600, marginBottom: 16 }}>
          {error.message}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!preselectedId && (
          <div>
            <label htmlFor="claim-invoice" style={{ display: 'block', fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 6 }}>
              Defaulted Invoice
            </label>
            {invLoading ? (
              <div style={{ color: MUTED, fontSize: 13 }}>Loading invoices…</div>
            ) : !hasDefaulted ? (
              <div style={{ padding: 12, borderRadius: 14, background: PANEL_ALT, color: MUTED, fontSize: 13 }}>
                No defaulted invoices found. Claims can only be filed on invoices in Defaulted status.
              </div>
            ) : (
              <select
                id="claim-invoice"
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                required
                style={selectStyle}
              >
                <option value="">Select a defaulted invoice…</option>
                {defaultedInvoices.map((inv) => (
                  <option key={String(inv.id)} value={String(inv.id)}>
                    Invoice #{String(inv.id)} — {inv.payer ? (
                      <>{inv.payer.slice(0, 6)}…{inv.payer.slice(-4)}</>
                    ) : 'Unknown'} — ${Number(inv.amount ?? 0n) / 10_000_000}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {preselectedId && (
          <div style={{ padding: 12, borderRadius: 14, background: PANEL_ALT, fontSize: 13 }}>
            Filing claim for invoice <strong>#{String(preselectedId)}</strong>
          </div>
        )}

        <div>
          <label htmlFor="claim-reason" style={{ display: 'block', fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 6 }}>
            Claim Reason
          </label>
          <textarea
            id="claim-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={10}
            rows={3}
            placeholder="Describe why this claim is valid (e.g., payer did not settle by due date)"
            style={{
              ...inputStyle,
              resize: 'vertical',
              minHeight: 80,
            }}
          />
        </div>

        {coverage && (
          <div style={{ padding: 12, borderRadius: 14, background: PANEL_ALT, fontSize: 12, color: MUTED }}>
            Your coverage: <strong style={{ color: TEXT }}>${Number(coverage.coverageAmount) / 10_000_000}</strong>
            &nbsp;| Premium rate: <strong style={{ color: TEXT }}>{(coverage.premiumRateBps / 100).toFixed(2)}%</strong>
            &nbsp;| Active claims: <strong style={{ color: TEXT }}>{coverage.activeClaims}</strong>
          </div>
        )}

        <button
          type="submit"
          disabled={isPending || !isEligible || !hasDefaulted || !selectedInvoiceId}
          style={{
            padding: '12px 24px',
            borderRadius: 14,
            border: 'none',
            fontWeight: 700,
            fontSize: 15,
            cursor: isPending || !isEligible || !hasDefaulted ? 'not-allowed' : 'pointer',
            background: isEligible && hasDefaulted ? ACCENT : BORDER,
            color: isEligible && hasDefaulted ? '#fff' : MUTED,
            alignSelf: 'flex-start',
          }}
        >
          {isPending ? 'Submitting…' : 'Submit Claim'}
        </button>
      </form>
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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'auto',
};
