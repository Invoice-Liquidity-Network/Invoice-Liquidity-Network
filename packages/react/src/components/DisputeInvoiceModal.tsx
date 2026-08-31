import React, { useState } from 'react';
import type { DisputeReasonCategory } from '@iln/shared';
import { useFileDispute } from '../hooks/useDispute';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { uploadToIpfs, isValidIpfsCid } from '../utils/ipfs';

export interface DisputeInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: bigint;
  payerAddress: string;
  invoiceAmount?: bigint;
  tokenSymbol?: string;
  onSuccess?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

const PANEL = '#FFFDF9';
const PANEL_ALT = '#F6EFE7';
const BORDER = '#E7DCCF';
const TEXT = '#1F2937';
const MUTED = '#5B6370';
const DANGER = '#B91C1C';
const ACCENT = '#8B5E34';

const CATEGORIES: { key: DisputeReasonCategory; label: string; description: string }[] = [
  {
    key: 'quality',
    label: 'Quality of Work',
    description: 'Work does not meet agreed specifications, has critical defects, or fails quality tests.',
  },
  {
    key: 'timing',
    label: 'Late Delivery / Timing',
    description: 'Agreed project deadlines were breached without authorized milestone extensions.',
  },
  {
    key: 'amount',
    label: 'Incorrect Amount / Scope',
    description: 'Invoice amount is inaccurate or includes unauthorized scope changes.',
  },
  {
    key: 'other',
    label: 'Other Breach',
    description: 'Contractual, communication, or licensing violation requiring arbitration.',
  },
];

export function DisputeInvoiceModal({
  isOpen,
  onClose,
  invoiceId,
  payerAddress,
  onSuccess,
  className,
  style,
}: DisputeInvoiceModalProps) {
  const dialogRef = useFocusTrap(isOpen);
  const { fileDispute, isPending, error } = useFileDispute();

  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [reasonCategory, setReasonCategory] = useState<DisputeReasonCategory>('quality');
  const [description, setDescription] = useState('');
  const [evidenceCid, setEvidenceCid] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingIpfs, setIsUploadingIpfs] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setIsUploadingIpfs(true);
    setUploadError(null);

    try {
      const res = await uploadToIpfs(file);
      setEvidenceCid(res.uri);
    } catch {
      setUploadError('Failed to upload file to IPFS. Please input CID manually.');
    } finally {
      setIsUploadingIpfs(false);
    }
  };

  const handleProceedToConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evidenceCid) {
      if (!description.trim()) {
        setUploadError('Please provide a description or upload evidence.');
        return;
      }
      setIsUploadingIpfs(true);
      try {
        const res = await uploadToIpfs(description, { fileName: `dispute-${invoiceId}.txt` });
        setEvidenceCid(res.uri);
        setStep('confirm');
      } catch {
        setUploadError('Failed to process evidence CID.');
      } finally {
        setIsUploadingIpfs(false);
      }
    } else {
      setStep('confirm');
    }
  };

  const handleFinalSubmit = async () => {
    try {
      await fileDispute({
        disputer: payerAddress,
        invoiceId,
        reasonCategory,
        reasonDescription: description,
        evidenceCid: evidenceCid || `ipfs://manual-${Date.now()}`,
      });
      onSuccess?.();
      onClose();
    } catch {
      // Surfaced via error state
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispute-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div
        ref={dialogRef as React.RefObject<HTMLDivElement>}
        className={className}
        style={{
          background: PANEL,
          border: `1px solid ${BORDER}`,
          borderRadius: 24,
          maxWidth: 580,
          width: '100%',
          padding: 28,
          color: TEXT,
          fontFamily: '"Manrope", "Segoe UI", sans-serif',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          ...style,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              color: DANGER,
            }}
          >
            Dispute Workflow
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: MUTED,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <h2
          id="dispute-modal-title"
          style={{
            fontFamily: '"Newsreader", Georgia, serif',
            fontSize: '1.8rem',
            margin: '0 0 8px 0',
            lineHeight: 1.1,
          }}
        >
          {step === 'form' ? `Dispute Invoice #${String(invoiceId)}` : 'Confirm Dispute Submission'}
        </h2>

        {step === 'form' ? (
          <form onSubmit={handleProceedToConfirm} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.4 }}>
              Filing a dispute pauses LP settlement and opens a 7-day evidence submission window for both parties.
            </p>

            <div>
              <label
                htmlFor="reason-category-select"
                style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}
              >
                Dispute Category
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {CATEGORIES.map((cat) => (
                  <label
                    key={cat.key}
                    style={{
                      border: `1px solid ${reasonCategory === cat.key ? ACCENT : BORDER}`,
                      background: reasonCategory === cat.key ? PANEL_ALT : PANEL,
                      borderRadius: 12,
                      padding: 10,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="radio"
                        name="reasonCategory"
                        value={cat.key}
                        checked={reasonCategory === cat.key}
                        onChange={() => setReasonCategory(cat.key)}
                        style={{ accentColor: ACCENT }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{cat.label}</span>
                    </div>
                    <span style={{ fontSize: 11, color: MUTED, lineHeight: 1.3 }}>{cat.description}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="dispute-description-input"
                style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}
              >
                Detailed Explanation
              </label>
              <textarea
                id="dispute-description-input"
                rows={3}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Explain why this invoice is disputed and summarize what went wrong..."
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="dispute-file-upload"
                style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}
              >
                Attach Evidence File (Auto-uploaded to IPFS)
              </label>
              <input
                id="dispute-file-upload"
                type="file"
                onChange={handleFileUpload}
                style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}
              />
              {isUploadingIpfs && (
                <div style={{ fontSize: 11, color: ACCENT, fontWeight: 600 }}>Uploading to IPFS...</div>
              )}
              {selectedFile && !isUploadingIpfs && evidenceCid && (
                <div style={{ fontSize: 11, color: '#15803D', fontWeight: 600 }}>
                  Attached: {selectedFile.name} ({evidenceCid.slice(0, 20)}...)
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="dispute-cid-input"
                style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}
              >
                Or IPFS CID directly
              </label>
              <input
                id="dispute-cid-input"
                type="text"
                value={evidenceCid}
                onChange={(e) => setEvidenceCid(e.target.value)}
                placeholder="ipfs://bafy... or Qm..."
                style={{
                  width: '100%',
                  padding: 8,
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {uploadError && (
              <div style={{ padding: 10, background: '#FEF2F2', color: DANGER, borderRadius: 8, fontSize: 12 }}>
                {uploadError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 18px',
                  background: PANEL_ALT,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!description.trim() || isUploadingIpfs}
                style={{
                  padding: '10px 20px',
                  background: DANGER,
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: !description.trim() || isUploadingIpfs ? 'not-allowed' : 'pointer',
                  opacity: !description.trim() || isUploadingIpfs ? 0.6 : 1,
                }}
              >
                Review Dispute Consequences →
              </button>
            </div>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: 16,
                padding: 16,
                fontSize: 12,
                color: DANGER,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                ⚠️ Consequences of Filing a Formal Dispute:
              </strong>
              <ul style={{ margin: '0 0 0 16px', padding: 0 }}>
                <li>Invoice settlement is immediately frozen.</li>
                <li>Both parties have 7 days to submit evidence.</li>
                <li>An admin arbitrator will evaluate the submissions to make a final binding resolution.</li>
                <li>If unattended, the dispute will auto-resolve in favor of the freelancer.</li>
                <li>Filing frivolous disputes may reduce your payer reputation score on-chain.</li>
              </ul>
            </div>

            <div
              style={{
                background: PANEL_ALT,
                padding: 14,
                borderRadius: 12,
                fontSize: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div>
                <strong>Category:</strong> {reasonCategory}
              </div>
              <div>
                <strong>Explanation:</strong> {description}
              </div>
              <div>
                <strong>Evidence CID:</strong> <code style={{ fontSize: 11 }}>{evidenceCid}</code>
              </div>
            </div>

            {error && (
              <div style={{ padding: 10, background: '#FEF2F2', color: DANGER, borderRadius: 8, fontSize: 12 }}>
                {error.message}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setStep('form')}
                disabled={isPending}
                style={{
                  padding: '10px 18px',
                  background: PANEL_ALT,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleFinalSubmit}
                disabled={isPending}
                style={{
                  padding: '10px 20px',
                  background: DANGER,
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: isPending ? 'not-allowed' : 'pointer',
                  opacity: isPending ? 0.7 : 1,
                }}
              >
                {isPending ? 'Submitting On-Chain...' : 'Confirm & File Dispute'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
