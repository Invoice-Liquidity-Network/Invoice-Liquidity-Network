import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DisputeAnalyticsDashboard } from './DisputeAnalyticsDashboard';
import { TestWrapper } from '../test/wrapper';
import { createMockILNClient, mockDisputeAnalytics } from '../test/mocks';

describe('DisputeAnalyticsDashboard', () => {
  it('renders analytics metrics and dispute reason breakdown', async () => {
    const mockClient = createMockILNClient({
      getDisputeAnalytics: vi.fn().mockResolvedValue(mockDisputeAnalytics),
    });

    render(
      <TestWrapper client={mockClient}>
        <DisputeAnalyticsDashboard />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Dispute Resolution Analytics')).toBeInTheDocument();
      expect(screen.getByText('Total Disputes')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
      expect(screen.getByText('Quality of Work')).toBeInTheDocument();
      expect(screen.getByText('Late Delivery / Timing')).toBeInTheDocument();
    });
  });
});
