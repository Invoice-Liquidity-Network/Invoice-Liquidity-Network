import { useRouter } from 'next/router';
import { DocsThemeConfig } from 'nextra-theme-docs';
import AlgoliaSearch from './components/AlgoliaSearch';

const config: DocsThemeConfig = {
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
  docsRepositoryBase: 'https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/blob/main/docs',
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
      <meta property="og:description" content="Turn unpaid invoices into instant liquidity on-chain, on Stellar." />
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
