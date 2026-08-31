import React, { useState } from 'react';

export interface AddressDisplayProps {
  address: string;
  /** Characters to show at start and end (default 6). */
  truncateChars?: number;
  /** Show copy button (default true). */
  copyable?: boolean;
  className?: string;
}

function truncate(addr: string, chars: number): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

export const AddressDisplay: React.FC<AddressDisplayProps> = ({
  address,
  truncateChars = 6,
  copyable = true,
  className,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — fail silently
    }
  };

  return (
    <span
      className={className}
      title={address}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'monospace',
        fontSize: 13,
      }}
    >
      {truncate(address, truncateChars)}
      {copyable && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy address'}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            fontSize: 12,
            color: '#6B7280',
          }}
        >
          {copied ? '✓' : '⎘'}
        </button>
      )}
    </span>
  );
};
