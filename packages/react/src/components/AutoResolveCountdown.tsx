import React, { useEffect, useState } from 'react';

export interface AutoResolveCountdownProps {
  autoResolveAt: number;
  onTriggerAutoResolve?: () => void;
  isPending?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const WARNING_BG = '#FFFBEB';
const WARNING_BORDER = '#FDE68A';
const WARNING_TEXT = '#92400E';
const DANGER_BG = '#FEF2F2';
const DANGER_BORDER = '#FECACA';
const DANGER_TEXT = '#991B1B';
const ACCENT = '#8B5E34';

function calculateTimeLeft(targetTs: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
} {
  const now = Math.floor(Date.now() / 1000);
  const diff = targetTs - now;

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
  }

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;

  return { days, hours, minutes, seconds, isExpired: false };
}

export function AutoResolveCountdown({
  autoResolveAt,
  onTriggerAutoResolve,
  isPending = false,
  className,
  style,
}: AutoResolveCountdownProps) {
  const [timeLeft, setTimeLeft] = useState(() => calculateTimeLeft(autoResolveAt));

  useEffect(() => {
    setTimeLeft(calculateTimeLeft(autoResolveAt));
    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft(autoResolveAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [autoResolveAt]);

  const bg = timeLeft.isExpired ? DANGER_BG : WARNING_BG;
  const border = timeLeft.isExpired ? DANGER_BORDER : WARNING_BORDER;
  const text = timeLeft.isExpired ? DANGER_TEXT : WARNING_TEXT;

  return (
    <aside
      className={className}
      aria-label="Auto-resolution Countdown"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 16,
        padding: 16,
        color: text,
        fontFamily: '"Manrope", "Segoe UI", sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {timeLeft.isExpired ? 'Auto-Resolution Window Expired' : 'Time to Auto-Resolution'}
        </span>
        <span
          data-testid="countdown-timer-value"
          style={{
            fontFamily: 'monospace',
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          {timeLeft.isExpired
            ? '0d 0h 0m 0s'
            : `${timeLeft.days}d ${timeLeft.hours}h ${timeLeft.minutes}m ${timeLeft.seconds}s`}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.4, opacity: 0.9 }}>
        {timeLeft.isExpired
          ? 'The evidence window has closed without manual arbitration. The dispute is eligible for automated execution in favor of the freelancer.'
          : 'If no arbitration decision is submitted before the timeout, the contract defaults to favoring the freelancer.'}
      </p>

      {timeLeft.isExpired && onTriggerAutoResolve && (
        <button
          type="button"
          onClick={onTriggerAutoResolve}
          disabled={isPending}
          style={{
            marginTop: 4,
            alignSelf: 'flex-start',
            padding: '8px 16px',
            background: ACCENT,
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 12,
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.7 : 1,
          }}
        >
          {isPending ? 'Executing Auto-Resolution...' : 'Execute Auto-Resolution'}
        </button>
      )}
    </aside>
  );
}
