import { InvoiceClient } from './InvoiceClient';

describe('InvoiceClient', () => {
  it('should initialize correctly', () => {
    const client = new InvoiceClient('https://horizon-testnet.stellar.org', 'CONTRACT_ID');
    expect(client).toBeDefined();
  });
});
