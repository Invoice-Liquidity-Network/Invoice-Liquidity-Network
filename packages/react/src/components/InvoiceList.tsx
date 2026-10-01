import React, { useState, useMemo, useEffect } from 'react';
import type { Invoice } from '@iln/sdk';
import { useInvoiceList } from '../hooks/useInvoiceList';

export interface InvoiceListProps {
  /** Static list of invoices to display. If omitted, and address/role are provided, it fetches automatically. */
  invoices?: Invoice[];
  /** Stellar address to query for automatic fetching */
  address?: string;
  /** Role filter for automatic fetching ('issuer' | 'lp' | 'payer') */
  role?: 'issuer' | 'lp' | 'payer';
  /** External loading state override */
  isLoading?: boolean;
  /** Callback fired when clicking an invoice row/card */
  onInvoiceClick?: (invoice: Invoice) => void;
  /** Callback fired when clicking an action button (e.g. "Fund", "Pay", "Mark Paid") */
  onActionClick?: (invoice: Invoice, action: 'fund' | 'pay' | 'mark-paid') => void;
  /** Whether to show search, status filtering, and sorting header. Default: true */
  showControls?: boolean;
  /** Theme preference */
  theme?: 'light' | 'dark' | 'system';
  /** Custom CSS style overrides */
  style?: React.CSSProperties;
  /** Custom CSS class names */
  className?: string;
}

export const InvoiceList: React.FC<InvoiceListProps> = ({
  invoices: staticInvoices,
  address = '',
  role = 'issuer',
  isLoading: staticLoading = false,
  onInvoiceClick,
  onActionClick,
  showControls = true,
  theme = 'system',
  style,
  className = '',
}) => {
  // ── Theme State ──────────────────────────────────────────────────────────
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    if (theme !== 'system') {
      setResolvedTheme(theme);
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setResolvedTheme(mq.matches ? 'dark' : 'light');
    const handler = (e: MediaQueryListEvent) => setResolvedTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const isDark = resolvedTheme === 'dark';

  // Colors
  const bg = isDark ? '#1e293b' : '#ffffff';
  const border = isDark ? '#334155' : '#e2e8f0';
  const textPrimary = isDark ? '#f1f5f9' : '#0f172a';
  const textMuted = isDark ? '#94a3b8' : '#64748b';
  const rowHoverBg = isDark ? '#1e293b' : '#f8fafc';
  const tableHeaderBg = isDark ? '#0f172a' : '#f8fafc';
  const searchBg = isDark ? '#0f172a' : '#f1f5f9';
  const skeletonBg = isDark ? '#334155' : '#e2e8f0';

  // ── Data Fetching ────────────────────────────────────────────────────────
  const isAutoFetch = !staticInvoices && !!address && address.startsWith('G');
  const {
    data: fetchedInvoices,
    isLoading: hookLoading,
    error,
  } = useInvoiceList(isAutoFetch ? address : '', role);

  const rawInvoices = staticInvoices ?? fetchedInvoices ?? [];
  const isLoading = staticLoading || (isAutoFetch && hookLoading);

  // ── Filters & Search States ──────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'pending' | 'funded' | 'paid' | 'defaulted'
  >('all');
  const [sortBy, setSortBy] = useState<'id' | 'amount' | 'dueDate'>('id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Filtered and Sorted Invoices
  const processedInvoices = useMemo(() => {
    let result = [...rawInvoices];

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((inv) => inv.status?.toLowerCase() === statusFilter);
    }

    // Search filter (by ID, issuer, or payer address)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (inv) =>
          String(inv.id).toLowerCase().includes(term) ||
          inv.freelancer.toLowerCase().includes(term) ||
          inv.payer.toLowerCase().includes(term)
      );
    }

    // Sorting
    result.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'id') {
        comparison = Number(a.id) - Number(b.id);
      } else if (sortBy === 'amount') {
        comparison = Number(a.amount) - Number(b.amount);
      } else if (sortBy === 'dueDate') {
        comparison = (a.dueDate ?? 0) - (b.dueDate ?? 0);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [rawInvoices, statusFilter, searchTerm, sortBy, sortOrder]);

  // Format amount
  const formatAmount = (amount: number | bigint) => {
    return (Number(amount) / 10_000_000).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Format date
  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Status Badge Colors
  const getStatusColor = (status?: string) => {
    const s = status?.toLowerCase();
    switch (s) {
      case 'paid':
        return {
          bg: isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
          color: '#22c55e',
        };
      case 'funded':
        return {
          bg: isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.1)',
          color: '#3b82f6',
        };
      case 'defaulted':
        return {
          bg: isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.1)',
          color: '#ef4444',
        };
      case 'disputed':
        return {
          bg: isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.1)',
          color: '#f59e0b',
        };
      default:
        return {
          bg: isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(148, 163, 184, 0.1)',
          color: '#94a3b8',
        };
    }
  };

  // Render Table Header sort indicator
  const renderSortIndicator = (field: 'id' | 'amount' | 'dueDate') => {
    if (sortBy !== field) return null;
    return sortOrder === 'asc' ? ' ▴' : ' ▾';
  };

  const handleSort = (field: 'id' | 'amount' | 'dueDate') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes iln-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .iln-skeleton-bar {
          background: linear-gradient(90deg, ${skeletonBg} 25%, ${
            isDark ? '#475569' : '#f1f5f9'
          } 50%, ${skeletonBg} 75%);
          background-size: 200% 100%;
          animation: iln-shimmer 1.5s infinite;
          border-radius: 4px;
        }
        .iln-invoice-row {
          transition: background-color 0.2s ease, transform 0.15s ease;
        }
        .iln-invoice-row:hover {
          background-color: ${rowHoverBg} !important;
          cursor: pointer;
        }
        .iln-tab-btn {
          cursor: pointer;
          transition: background-color 0.2s, color 0.2s;
        }
        .iln-mobile-card {
          border: 1px solid ${border};
          border-radius: 12px;
          padding: 16px;
          background: ${bg};
          margin-bottom: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        @media (min-width: 640px) {
          .iln-mobile-cards { display: none !important; }
          .iln-desktop-table { display: table !important; }
        }
        @media (max-width: 639px) {
          .iln-mobile-cards { display: block !important; }
          .iln-desktop-table { display: none !important; }
        }
      `,
        }}
      />
      <div
        className={className}
        style={{
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: '12px',
          padding: '20px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: textPrimary,
          boxSizing: 'border-box',
          width: '100%',
          ...style,
        }}
      >
        {/* Controls Panel */}
        {showControls && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              {/* Search */}
              <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
                <input
                  type="text"
                  placeholder="Search by ID, Issuer, or Payer..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '8px',
                    border: `1px solid ${border}`,
                    background: searchBg,
                    color: textPrimary,
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <svg
                  style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: textMuted,
                  }}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>

              {/* Sorting for mobile */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: textMuted }}>Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => handleSort(e.target.value as any)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: `1px solid ${border}`,
                    background: bg,
                    color: textPrimary,
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  <option value="id">Invoice ID</option>
                  <option value="amount">Amount</option>
                  <option value="dueDate">Due Date</option>
                </select>
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: `1px solid ${border}`,
                    background: bg,
                    color: textPrimary,
                    cursor: 'pointer',
                  }}
                >
                  {sortOrder === 'asc' ? '▲' : '▼'}
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                borderBottom: `1px solid ${border}`,
                paddingBottom: '10px',
              }}
            >
              {(['all', 'pending', 'funded', 'paid', 'defaulted'] as const).map((tab) => {
                const isActive = statusFilter === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setStatusFilter(tab)}
                    className="iln-tab-btn"
                    style={{
                      padding: '8px 16px',
                      borderRadius: '6px',
                      border: 'none',
                      background: isActive ? (isDark ? '#3b82f6' : '#eff6ff') : 'transparent',
                      color: isActive ? (isDark ? '#ffffff' : '#1d4ed8') : textMuted,
                      fontWeight: isActive ? 600 : 500,
                      fontSize: '13px',
                      textTransform: 'capitalize',
                    }}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                style={{
                  display: 'flex',
                  gap: '16px',
                  padding: '16px 8px',
                  borderBottom: `1px solid ${border}`,
                }}
              >
                <div className="iln-skeleton-bar" style={{ width: '60px', height: '18px' }} />
                <div
                  className="iln-skeleton-bar"
                  style={{ width: '80px', height: '18px', marginLeft: 'auto' }}
                />
                <div className="iln-skeleton-bar" style={{ width: '120px', height: '18px' }} />
                <div className="iln-skeleton-bar" style={{ width: '70px', height: '18px' }} />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!isLoading && error && (
          <div style={{ textAlign: 'center', padding: '24px', color: '#ef4444' }}>
            <svg
              style={{ marginBottom: '8px' }}
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <div style={{ fontWeight: 600 }}>Failed to load invoices</div>
            <div style={{ fontSize: '13px', opacity: 0.8, marginTop: '4px' }}>{error.message}</div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && processedInvoices.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: textMuted }}>
            <svg
              style={{ opacity: 0.5, marginBottom: '12px' }}
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="4"></line>
              <line x1="8" y1="2" x2="8" y2="4"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <div style={{ fontWeight: 600, fontSize: '16px', color: textPrimary }}>
              No invoices found
            </div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>
              There are no invoices matching the current criteria.
            </div>
          </div>
        )}

        {/* Desktop Table View */}
        {!isLoading && !error && processedInvoices.length > 0 && (
          <table
            className="iln-desktop-table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '14px',
              display: 'none',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: `2px solid ${border}`,
                  color: textMuted,
                  background: tableHeaderBg,
                }}
              >
                <th
                  style={{ padding: '12px 16px', fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => handleSort('id')}
                >
                  Invoice ID {renderSortIndicator('id')}
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                <th
                  style={{ padding: '12px 16px', fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => handleSort('amount')}
                >
                  Amount {renderSortIndicator('amount')}
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Discount Rate</th>
                <th
                  style={{ padding: '12px 16px', fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => handleSort('dueDate')}
                >
                  Due Date {renderSortIndicator('dueDate')}
                </th>
                {(onActionClick || onInvoiceClick) && (
                  <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {processedInvoices.map((inv) => {
                const statusColor = getStatusColor(inv.status);
                return (
                  <tr
                    key={String(inv.id)}
                    className="iln-invoice-row"
                    onClick={() => onInvoiceClick?.(inv)}
                    style={{ borderBottom: `1px solid ${border}` }}
                  >
                    <td style={{ padding: '16px', fontWeight: 600 }}>#{String(inv.id)}</td>
                    <td style={{ padding: '16px' }}>
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: '9999px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor: statusColor.bg,
                          color: statusColor.color,
                          textTransform: 'capitalize',
                          display: 'inline-block',
                        }}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td style={{ padding: '16px', fontWeight: 600 }}>
                      {formatAmount(inv.amount)} USDC
                    </td>
                    <td style={{ padding: '16px' }}>{(inv.discountRate / 100).toFixed(2)}%</td>
                    <td style={{ padding: '16px', color: textMuted }}>{formatDate(inv.dueDate)}</td>
                    {(onActionClick || onInvoiceClick) && (
                      <td
                        style={{ padding: '16px', textAlign: 'right' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          {inv.status === 'Pending' && role === 'lp' && onActionClick && (
                            <button
                              onClick={() => onActionClick(inv, 'fund')}
                              style={{
                                padding: '6px 12px',
                                background: '#3b82f6',
                                color: '#white',
                                border: 'none',
                                borderRadius: '6px',
                                fontWeight: 600,
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              Fund
                            </button>
                          )}
                          {inv.status === 'Pending' && role === 'payer' && onActionClick && (
                            <button
                              onClick={() => onActionClick(inv, 'pay')}
                              style={{
                                padding: '6px 12px',
                                background: '#10b981',
                                color: '#white',
                                border: 'none',
                                borderRadius: '6px',
                                fontWeight: 600,
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              Pay
                            </button>
                          )}
                          {inv.status === 'Funded' && role === 'issuer' && onActionClick && (
                            <button
                              onClick={() => onActionClick(inv, 'mark-paid')}
                              style={{
                                padding: '6px 12px',
                                background: '#6366f1',
                                color: '#white',
                                border: 'none',
                                borderRadius: '6px',
                                fontWeight: 600,
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              Mark Paid
                            </button>
                          )}
                          <button
                            onClick={() => onInvoiceClick?.(inv)}
                            style={{
                              padding: '6px 12px',
                              background: 'transparent',
                              border: `1px solid ${border}`,
                              borderRadius: '6px',
                              color: textPrimary,
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            Details
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Mobile Grid/Card View */}
        {!isLoading && !error && processedInvoices.length > 0 && (
          <div className="iln-mobile-cards" style={{ display: 'none' }}>
            {processedInvoices.map((inv) => {
              const statusColor = getStatusColor(inv.status);
              return (
                <div
                  key={String(inv.id)}
                  className="iln-mobile-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => onInvoiceClick?.(inv)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onInvoiceClick?.(inv);
                    }
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '12px',
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: '15px' }}>
                      Invoice #{String(inv.id)}
                    </span>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: statusColor.bg,
                        color: statusColor.color,
                        textTransform: 'capitalize',
                      }}
                    >
                      {inv.status}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px 16px',
                      fontSize: '13px',
                      marginBottom: '12px',
                    }}
                  >
                    <div>
                      <div
                        style={{ color: textMuted, fontSize: '11px', textTransform: 'uppercase' }}
                      >
                        Amount
                      </div>
                      <div style={{ fontWeight: 600, marginTop: '2px' }}>
                        {formatAmount(inv.amount)} USDC
                      </div>
                    </div>
                    <div>
                      <div
                        style={{ color: textMuted, fontSize: '11px', textTransform: 'uppercase' }}
                      >
                        Discount
                      </div>
                      <div style={{ fontWeight: 600, marginTop: '2px' }}>
                        {(inv.discountRate / 100).toFixed(2)}%
                      </div>
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      <div
                        style={{ color: textMuted, fontSize: '11px', textTransform: 'uppercase' }}
                      >
                        Due Date
                      </div>
                      <div style={{ fontWeight: 500, marginTop: '2px' }}>
                        {formatDate(inv.dueDate)}
                      </div>
                    </div>
                  </div>

                  {/* Actions — onClick here only stops propagation to the card's
                      click handler above; the real interactive elements are the
                      <button>s inside. */}
                  {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      marginTop: '12px',
                      borderTop: `1px solid ${border}`,
                      paddingTop: '12px',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {inv.status === 'Pending' && role === 'lp' && onActionClick && (
                      <button
                        onClick={() => onActionClick(inv, 'fund')}
                        style={{
                          flex: 1,
                          padding: '8px',
                          background: '#3b82f6',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Fund
                      </button>
                    )}
                    {inv.status === 'Pending' && role === 'payer' && onActionClick && (
                      <button
                        onClick={() => onActionClick(inv, 'pay')}
                        style={{
                          flex: 1,
                          padding: '8px',
                          background: '#10b981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Pay
                      </button>
                    )}
                    {inv.status === 'Funded' && role === 'issuer' && onActionClick && (
                      <button
                        onClick={() => onActionClick(inv, 'mark-paid')}
                        style={{
                          flex: 1,
                          padding: '8px',
                          background: '#6366f1',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Mark Paid
                      </button>
                    )}
                    <button
                      onClick={() => onInvoiceClick?.(inv)}
                      style={{
                        flex: 1,
                        padding: '8px',
                        background: 'transparent',
                        border: `1px solid ${border}`,
                        borderRadius: '6px',
                        color: textPrimary,
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};
