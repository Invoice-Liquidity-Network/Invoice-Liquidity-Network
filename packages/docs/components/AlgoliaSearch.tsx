'use client';

import { useEffect, useRef, useState } from 'react';

interface AlgoliaSearchProps {
  appId?: string;
  apiKey?: string;
  indexName?: string;
}

/**
 * Algolia DocSearch integration for the Nextra 3 docs site.
 *
 * Uses the @docsearch/react component with Cmd+K keyboard shortcut.
 * Environment variables:
 *   NEXT_PUBLIC_ALGOLIA_APP_ID
 *   NEXT_PUBLIC_ALGOLIA_API_KEY
 *   NEXT_PUBLIC_ALGOLIA_INDEX_NAME
 */
export function AlgoliaSearch({
  appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID || 'YOUR_APP_ID',
  apiKey = process.env.NEXT_PUBLIC_ALGOLIA_API_KEY || 'YOUR_API_KEY',
  indexName = process.env.NEXT_PUBLIC_ALGOLIA_INDEX_NAME || 'iln-docs',
}: AlgoliaSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [DocSearch, setDocSearch] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    // Dynamically import DocSearch to avoid SSR issues
    import('@docsearch/react').then((mod) => {
      setDocSearch(() => mod.DocSearch);
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!DocSearch) {
    return null;
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="nextra-search-button"
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
        <span>Search...</span>
        <kbd>⌘K</kbd>
      </button>

      {isOpen && (
        <DocSearch
          appId={appId}
          apiKey={apiKey}
          indexName={indexName}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}

export default AlgoliaSearch;
