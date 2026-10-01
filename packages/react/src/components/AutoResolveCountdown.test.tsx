import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutoResolveCountdown } from './AutoResolveCountdown';

describe('AutoResolveCountdown', () => {
  it('renders countdown timer when timeout is in the future', () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 3; // 3 days in future
    render(<AutoResolveCountdown autoResolveAt={futureTimestamp} />);

    expect(screen.getByText('Time to Auto-Resolution')).toBeInTheDocument();
    expect(screen.getByTestId('countdown-timer-value')).toHaveTextContent(/d.*h.*m.*s/);
  });

  it('renders expired notice and trigger button when timeout has passed', () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 100;
    const onTrigger = vi.fn();
    render(<AutoResolveCountdown autoResolveAt={pastTimestamp} onTriggerAutoResolve={onTrigger} />);

    expect(screen.getByText('Auto-Resolution Window Expired')).toBeInTheDocument();
    expect(screen.getByText('Execute Auto-Resolution')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Execute Auto-Resolution'));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});
