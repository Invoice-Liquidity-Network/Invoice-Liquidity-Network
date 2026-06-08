import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Banner, Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import './globals.css'

export const metadata = {
  title: {
    template: '%s | ILN Docs',
    default: 'Invoice Liquidity Network Documentation'
  },
  description: 'Documentation for the Invoice Liquidity Network protocol built on Stellar',
  metadataBase: new URL('https://docs.iln.finance')
}

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
    />
  )

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head faviconGlyph="⚡" />
      <body>
        <Banner storageKey="iln-docs-banner">
          🚀 ILN is currently on Stellar testnet. Mainnet coming after audit.
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
  )
}