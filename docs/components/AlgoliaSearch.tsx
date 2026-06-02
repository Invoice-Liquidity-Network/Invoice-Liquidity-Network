'use client';

import { useEffect, useRef, useState } from 'react';
import { DocSearch } from '@docsearch/react';
import '@docsearch/css';

export default function AlgoliaSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K on Mac, Ctrl+K on Windows/Linux
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      // Escape to close
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      <button
        ref={searchButtonRef}
        onClick={() => setIsOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          backgroundColor: '#f5f5f5',
          border: '1px solid #e0e0e0',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px',
          color: '#666',
        }}
        title="Search docs (Cmd+K or Ctrl+K)"
      >
        <svg
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
          <path d="m21 21-4.35-4.35"></path>
        </svg>
        <span style={{ display: 'inline-block', minWidth: '80px', textAlign: 'left' }}>
          Search...
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '12px', opacity: 0.6 }}>
          ⌘K
        </span>
      </button>

      {isOpen && (
        <DocSearch
          appId={process.env.NEXT_PUBLIC_ALGOLIA_APP_ID || 'YOUR_APP_ID'}
          apiKey={process.env.NEXT_PUBLIC_ALGOLIA_API_KEY || 'YOUR_API_KEY'}
          indexName={process.env.NEXT_PUBLIC_ALGOLIA_INDEX_NAME || 'iln-docs'}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
