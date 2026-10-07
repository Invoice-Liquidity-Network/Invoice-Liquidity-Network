import type { NextConfig } from 'next';
import nextra from 'nextra';

const withNextra = nextra({
  defaultShowCopyCode: true,
  search: {
    codeblocks: true,
  },
});

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'dist',
  images: {
    unoptimized: true,
  },
  // The standalone lint workflow validates this package; Next's bundled lint runner
  // passes options that are incompatible with the workspace's ESLint version.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withNextra(nextConfig);
