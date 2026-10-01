import React from 'react';
import type { DisputeEvidence } from '@iln/shared';
import { AddressDisplay } from './AddressDisplay';
import { getIpfsGatewayUrl } from '../utils/ipfs';

export interface EvidenceViewerProps {
  evidence: DisputeEvidence[];
  className?: string;
  style?: React.CSSProperties;
  customGateway?: string;
}

const PANEL = '#FFFDF9';
const PANEL_ALT = '#F6EFE7';
const BORDER = '#E7DCCF';
const TEXT = '#1F2937';
const MUTED = '#5B6370';
const ACCENT = '#8B5E34';
const PAYER_BG = '#EFF6FF';
const PAYER_TEXT = '#1E40AF';
const FREELANCER_BG = '#ECFDF5';
const FREELANCER_TEXT = '#065F46';
const ADMIN_BG = '#F3E8FF';
const ADMIN_TEXT = '#6B21A8';

function formatTimestamp(ts: number | undefined | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EvidenceViewer({
  evidence,
  className,
  style,
  customGateway,
}: EvidenceViewerProps) {
  if (!evidence || evidence.length === 0) {
    return (
      <div
        className={className}
        style={{
          padding: 20,
          background: PANEL_ALT,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          textAlign: 'center',
          color: MUTED,
          fontSize: 13,
          ...style,
        }}
      >
        No evidence has been submitted yet for this dispute.
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontFamily: '"Manrope", "Segoe UI", sans-serif',
        ...style,
      }}
    >
      {evidence.map((item, index) => {
        const isPayer = item.role === 'payer';
        const isFreelancer = item.role === 'freelancer';
        const roleBg = isPayer ? PAYER_BG : isFreelancer ? FREELANCER_BG : ADMIN_BG;
        const roleText = isPayer ? PAYER_TEXT : isFreelancer ? FREELANCER_TEXT : ADMIN_TEXT;
        const roleLabel = isPayer ? 'Payer' : isFreelancer ? 'Freelancer' : 'Admin';
        const gatewayUrl = getIpfsGatewayUrl(item.evidenceCid, customGateway);

        return (
          <article
            key={item.id || `evidence-${index}`}
            data-testid={`evidence-item-${index}`}
            style={{
              padding: 16,
              background: PANEL,
              border: `1px solid ${BORDER}`,
              borderRadius: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '2px 8px',
                    borderRadius: 9999,
                    background: roleBg,
                    color: roleText,
                  }}
                >
                  {roleLabel}
                </span>
                <AddressDisplay address={item.submitter} style={{ fontSize: 12 }} />
              </div>
              <time
                dateTime={new Date(item.submittedAt * 1000).toISOString()}
                style={{ fontSize: 11, color: MUTED }}
              >
                {formatTimestamp(item.submittedAt)}
              </time>
            </div>

            <p style={{ margin: 0, fontSize: 13, color: TEXT, lineHeight: 1.5 }}>
              {item.description}
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 4,
                paddingTop: 8,
                borderTop: `1px dashed ${BORDER}`,
              }}
            >
              {item.fileName ? (
                <div
                  style={{
                    fontSize: 12,
                    color: MUTED,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span style={{ fontWeight: 600, color: TEXT }}>{item.fileName}</span>
                  {item.fileSize ? <span>({formatFileSize(item.fileSize)})</span> : null}
                </div>
              ) : (
                <span style={{ fontSize: 11, color: MUTED }}>IPFS Hash</span>
              )}

              <a
                href={gatewayUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: ACCENT,
                  textDecoration: 'none',
                  background: PANEL_ALT,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: `1px solid ${BORDER}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>{item.evidenceCid.slice(0, 16)}...</span>
                <span>↗</span>
              </a>
            </div>
          </article>
        );
      })}
    </div>
  );
}
