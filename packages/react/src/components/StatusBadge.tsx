import React from 'react';
import type { InvoiceStatus } from '@iln/sdk';

export interface StatusBadgeProps {
  status: InvoiceStatus;
  className?: string;
}

const STYLE_MAP: Record<InvoiceStatus, { bg: string; text: string; label: string }> = {
  Pending: { bg: '#FEF9C3', text: '#854D0E', label: 'Pending' },
  Funded: { bg: '#DCFCE7', text: '#166534', label: 'Funded' },
  Paid: { bg: '#DBEAFE', text: '#1E40AF', label: 'Paid' },
  Defaulted: { bg: '#FEE2E2', text: '#991B1B', label: 'Defaulted' },
  Disputed: { bg: '#FFEDD5', text: '#9A3412', label: 'Disputed' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => {
  const style = STYLE_MAP[status] ?? { bg: '#F3F4F6', text: '#374151', label: status };
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: style.bg,
        color: style.text,
      }}
    >
      {style.label}
    </span>
  );
};
