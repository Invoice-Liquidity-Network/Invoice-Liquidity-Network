import type { NextConfig } from 'next'
import nextra from 'nextra'

const withNextra = nextra({
  contentDirBasePath: '/',
  defaultShowCopyCode: true,
  search: {
    codeblocks: true
  }
})

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'dist',
  images: {
    unoptimized: true
  }
}

export default withNextra(nextConfig)