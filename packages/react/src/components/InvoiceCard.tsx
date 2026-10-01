import React from 'react';
import type { Invoice } from '@iln/sdk';
import { StatusBadge } from './StatusBadge';
import { AddressDisplay } from './AddressDisplay';
import { AmountDisplay } from './AmountDisplay';
import { useILNTheme } from './ThemeProvider';
import { AuctionRateTicker } from './AuctionRateTicker';

export interface InvoiceCardProps {
  invoice: Invoice;
  /** Called when the user clicks the card. */
  onClick?: (invoice: Invoice) => void;
  /** LP wallet address used by the embedded Dutch auction fund action. */
  funder?: string;
  /** Whether to show the Dutch auction rate panel for pending auction invoices. */
  showAuctionTicker?: boolean;
  /** Optional custom funding handler for the embedded Dutch auction button. */
  onAuctionFund?: (params: {
    invoiceId: number;
    currentDiscountBps: number;
    funder?: string;
  }) => Promise<void> | void;
  className?: string;
}

function hasAuctionFields(invoice: Invoice): boolean {
  const record = invoice as unknown as Record<string, unknown>;
  return (
    (record.startDiscountBps !== undefined || record.start_discount_bps !== undefined) &&
    (record.maxDiscountBps !== undefined || record.max_discount_bps !== undefined) &&
    (record.auctionStepBps !== undefined || record.auction_step_bps !== undefined) &&
    (record.stepIntervalSeconds !== undefined || record.step_interval_seconds !== undefined)
  );
}

function formatDueDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const InvoiceCard: React.FC<InvoiceCardProps> = ({
  invoice,
  onClick,
  funder,
  showAuctionTicker = true,
  onAuctionFund,
  className,
}) => {
  const theme = useILNTheme();
  const showAuction =
    showAuctionTicker &&
    String(invoice.status).toLowerCase() === 'pending' &&
    hasAuctionFields(invoice);

  const cardStyle: React.CSSProperties = {
    background: theme.colorBg,
    border: `1px solid ${theme.colorBorder}`,
    borderRadius: theme.borderRadius,
    padding: '16px 20px',
    fontFamily: theme.fontFamily,
    color: theme.colorText,
    cursor: onClick ? 'pointer' : undefined,
    transition: 'box-shadow 0.15s ease',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: theme.colorTextMuted,
    marginBottom: 2,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 500,
  };

  const isClickable = !!onClick;

  return (
    <div
      className={className}
      style={cardStyle}
      onClick={isClickable ? () => onClick(invoice) : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={
        isClickable ? `Invoice #${String(invoice.id)} — click to view details` : undefined
      }
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick(invoice);
            }
          : undefined
      }
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700 }}>Invoice #{String(invoice.id)}</span>
        <StatusBadge status={invoice.status as any} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
        <div>
          <div style={labelStyle}>Issuer</div>
          <div style={valueStyle}>
            <AddressDisplay
              address={(invoice.freelancer as unknown as string) ?? ''}
              copyable={!isClickable}
            />
          </div>
        </div>

        <div>
          <div style={labelStyle}>Payer</div>
          <div style={valueStyle}>
            <AddressDisplay
              address={(invoice.payer as unknown as string) ?? ''}
              copyable={!isClickable}
            />
          </div>
        </div>

        <div>
          <div style={labelStyle}>Amount</div>
          <div style={{ ...valueStyle, fontWeight: 700, color: theme.colorPrimary }}>
            <AmountDisplay amount={invoice.amount as unknown as bigint} />
          </div>
        </div>

        <div>
          <div style={labelStyle}>Due Date</div>
          <div style={valueStyle}>{formatDueDate(invoice.dueDate as unknown as number)}</div>
        </div>
      </div>

      {showAuction && (
        <AuctionRateTicker
          invoiceId={Number(invoice.id)}
          invoice={invoice}
          funder={funder}
          showChart={false}
          onFund={onAuctionFund}
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
};
