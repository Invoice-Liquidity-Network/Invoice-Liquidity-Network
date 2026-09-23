import { useRouter } from 'next/router';
import { DocsThemeConfig } from 'nextra-theme-docs';
import AlgoliaSearch from './components/AlgoliaSearch';

// Mirrors docs/version-manifest.json — see docs/versioning.md. The docs site is
// single-track (always the latest testnet build), so the banner has to state which
// release the prose was written against. scripts/check-compatibility.ts fails CI if
// these values drift from the manifest or from the cross-repo compatibility matrix.
const DOCS_CONTRACT_VERSION = '0.1.0';
const DOCS_CONTRACT_ID = 'CCPASLHKRFBMVV5PZG3LKDGKFEDXZMB5U7DK42CVLUVWCMUCSRPVBIMO';
const DOCS_SDK_VERSION = '0.1.0';

const config: DocsThemeConfig = {
  // Keyed on the contract version so a reader who dismissed the banner sees it
  // again once the docs start tracking a newer release.
  banner: {
    key: `iln-docs-version-${DOCS_CONTRACT_VERSION}`,
    text: (
      <a href="/versioning">
        These docs track the latest release on Stellar testnet — contract v{DOCS_CONTRACT_VERSION} (
        {DOCS_CONTRACT_ID.slice(0, 6)}…{DOCS_CONTRACT_ID.slice(-6)}) and SDK v{DOCS_SDK_VERSION}.
        Check your versions →
      </a>
    ),
  },
  logo: (
    <>
      <span style={{ fontWeight: 900, fontSize: '1.25rem' }}>Invoice Liquidity Network</span>
    </>
  ),
  project: {
    link: 'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network',
  },
  chat: {
    link: 'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/discussions',
  },
  docsRepositoryBase:
    'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs',
  footer: {
    text: '© 2024 Invoice Liquidity Network. MIT License.',
  },
  primaryHue: 200,
  search: {
    component: <AlgoliaSearch />,
    emptyResult: (
      <div style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
        <p>No results found</p>
      </div>
    ),
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta property="og:title" content="Invoice Liquidity Network Docs" />
      <meta
        property="og:description"
        content="Turn unpaid invoices into instant liquidity on-chain, on Stellar."
      />
    </>
  ),
  useNextSeoProps() {
    const { asPath } = useRouter();
    if (asPath !== '/') {
      return {
        titleTemplate: '%s – ILN Docs',
      };
    }
  },
};

export default config;
