import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Banner, Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import { VersionBanner } from '../components/VersionBanner';
import { AlgoliaSearch } from '../components/AlgoliaSearch';
import { CONTRACT_VERSION } from '../lib/docs-version';
import 'nextra-theme-docs/style.css';
import './globals.css';

export const metadata = {
  title: {
    template: '%s | ILN Docs',
    default: 'Invoice Liquidity Network Documentation',
  },
  description: 'Documentation for the Invoice Liquidity Network protocol built on Stellar',
  metadataBase: new URL('https://docs.iln.finance'),
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const navbar = (
    <Navbar
      logo={
        <div className="flex items-center gap-2 font-bold text-xl">
          <span>⚡</span>
          <span>ILN Docs</span>
        </div>
      }
      projectLink="https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network"
    >
      <AlgoliaSearch />
    </Navbar>
  );

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head faviconGlyph="⚡" />
      <body>
        {/*
          The storage key is bound to the documented contract version so that a
          reader who dismissed the banner is shown it again once the docs start
          tracking a newer release.
        */}
        <Banner storageKey={`iln-docs-version-${CONTRACT_VERSION}`}>
          <VersionBanner />
        </Banner>
        <Layout
          navbar={navbar}
          footer={<Footer>MIT {new Date().getFullYear()} © Invoice Liquidity Network.</Footer>}
          editLink="Edit this page on GitHub"
          docsRepositoryBase="https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/tree/main/packages/docs"
          sidebar={{ defaultMenuCollapseLevel: 1, toggleButton: true }}
          pageMap={await getPageMap()}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
