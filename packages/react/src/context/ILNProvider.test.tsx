import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ILNProvider, useILNClient, ILNProviderNotFoundError } from './index';
import { createMockILNClient } from '../test/mocks';

describe('ILNProvider', () => {
  it('provides client to children via context', () => {
    const mockClient = createMockILNClient();
    
    function Consumer() {
      const client = useILNClient();
      return <div data-testid="client">{client ? 'available' : 'missing'}</div>;
    }

    render(
      <ILNProvider client={mockClient}>
        <Consumer />
      </ILNProvider>
    );

    expect(screen.getByTestId('client')).toHaveTextContent('available');
  });

  it('throws ILNProviderNotFoundError when useILNClient is called outside provider', () => {
    function BadConsumer() {
      useILNClient();
      return null;
    }

    // Suppress console.error for expected throw
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => render(<BadConsumer />)).toThrow(ILNProviderNotFoundError);
    
    consoleSpy.mockRestore();
  });

  it('passes through children unchanged', () => {
    const mockClient = createMockILNClient();
    
    const { container } = render(
      <ILNProvider client={mockClient}>
        <span>child content</span>
      </ILNProvider>
    );

    expect(container).toHaveTextContent('child content');
  });
});