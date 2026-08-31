// React example for the ILN SDK
// Demonstrates a simple invoice submission form with the ILN SDK

import React, { useState, useEffect, useCallback } from 'react';
import { ILNSdk, ILN_TESTNET, createFreighterSigner } from '@iln/sdk';
import type { Invoice, ProtocolConfig, TransactionSigner } from '@iln/sdk';

// ── SDK Singleton ────────────────────────────────────────────────────────────

const freighterSigner = createFreighterSigner();

function createSdk(): ILNSdk {
  return new ILNSdk({
    ...ILN_TESTNET,
    signer: freighterSigner,
  });
}

// ── Invoice Form Component ───────────────────────────────────────────────────

interface InvoiceFormProps {
  sdk: ILNSdk;
  onSubmit: (invoiceId: bigint) => void;
  onError: (error: string) => void;
}

function InvoiceForm({ sdk, onSubmit, onError }: InvoiceFormProps) {
  const [payer, setPayer] = useState('');
  const [amount, setAmount] = useState('');
  const [discountRate, setDiscountRate] = useState('500');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const invoiceId = await sdk.submitInvoice({
        freelancer: await freighterSigner.getPublicKey(),
        payer,
        amount: BigInt(Math.floor(parseFloat(amount) * 10_000_000)),
        dueDate: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        discountRate: parseInt(discountRate, 10),
      });

      onSubmit(invoiceId);
    } catch (err: any) {
      onError(err.message ?? 'Failed to submit invoice');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 400, margin: '0 auto' }}>
      <h2>Submit Invoice</h2>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>Payer Address (G...)</label>
        <input
          type="text"
          value={payer}
          onChange={(e) => setPayer(e.target.value)}
          placeholder="G..."
          required
          style={{ width: '100%', padding: 8 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>Amount (USDC)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="10.00"
          required
          style={{ width: '100%', padding: 8 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>Discount Rate (basis points)</label>
        <input
          type="number"
          min="0"
          max="10000"
          value={discountRate}
          onChange={(e) => setDiscountRate(e.target.value)}
          style={{ width: '100%', padding: 8 }}
        />
        <small>{(parseInt(discountRate || '0', 10) / 100).toFixed(1)}%</small>
      </div>

      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%',
          padding: 10,
          backgroundColor: loading ? '#ccc' : '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Submitting...' : 'Submit Invoice'}
      </button>
    </form>
  );
}

// ── Invoice List Component ───────────────────────────────────────────────────

interface InvoiceListProps {
  invoices: Invoice[];
}

function InvoiceList({ invoices }: InvoiceListProps) {
  if (invoices.length === 0) {
    return <p style={{ textAlign: 'center' }}>No invoices yet.</p>;
  }

  return (
    <div style={{ maxWidth: 600, margin: '20px auto' }}>
      <h2>Invoices</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ddd' }}>
            <th style={{ padding: 8, textAlign: 'left' }}>ID</th>
            <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
            <th style={{ padding: 8, textAlign: 'right' }}>Amount</th>
            <th style={{ padding: 8, textAlign: 'right' }}>Discount</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={String(inv.id)} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>{String(inv.id)}</td>
              <td style={{ padding: 8 }}>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    backgroundColor:
                      inv.status === 'Paid'
                        ? '#10b981'
                        : inv.status === 'Funded'
                        ? '#3b82f6'
                        : inv.status === 'Defaulted'
                        ? '#ef4444'
                        : '#f59e0b',
                    color: 'white',
                    fontSize: 12,
                  }}
                >
                  {inv.status}
                </span>
              </td>
              <td style={{ padding: 8, textAlign: 'right' }}>
                {(Number(inv.amount) / 10_000_000).toFixed(2)} USDC
              </td>
              <td style={{ padding: 8, textAlign: 'right' }}>
                {(inv.discountRate / 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [sdk] = useState(() => createSdk());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [config, setConfig] = useState<ProtocolConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    sdk.getProtocolConfig().then(setConfig).catch(console.error);
  }, [sdk]);

  const handleSubmit = useCallback(
    async (invoiceId: bigint) => {
      setSuccess(`Invoice ${invoiceId} submitted successfully!`);
      setError(null);

      // Refresh invoice list
      try {
        const invoice = await sdk.getInvoice(invoiceId);
        setInvoices((prev) => [invoice, ...prev]);
      } catch {
        // Ignore refresh errors
      }
    },
    [sdk]
  );

  const handleError = useCallback((msg: string) => {
    setError(msg);
    setSuccess(null);
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ textAlign: 'center' }}>ILN React Example</h1>

      {config && (
        <div
          style={{
            maxWidth: 400,
            margin: '0 auto 20px',
            padding: 12,
            backgroundColor: '#f3f4f6',
            borderRadius: 8,
            fontSize: 14,
          }}
        >
          <strong>Protocol Config:</strong>
          <br />
          Max discount: {config.maxDiscountRate} bps | Fee: {config.protocolFeeBps} bps
        </div>
      )}

      {error && (
        <div
          style={{
            maxWidth: 400,
            margin: '0 auto 12px',
            padding: 12,
            backgroundColor: '#fef2f2',
            color: '#dc2626',
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            maxWidth: 400,
            margin: '0 auto 12px',
            padding: 12,
            backgroundColor: '#f0fdf4',
            color: '#16a34a',
            borderRadius: 8,
          }}
        >
          {success}
        </div>
      )}

      <InvoiceForm sdk={sdk} onSubmit={handleSubmit} onError={handleError} />
      <InvoiceList invoices={invoices} />
    </div>
  );
}
