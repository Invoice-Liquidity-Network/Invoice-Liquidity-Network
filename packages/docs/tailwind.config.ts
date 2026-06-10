import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './content/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/nextra-theme-docs/dist/**/*.js'
  ],
  theme: {
    extend: {}
  },
  plugins: []
}

export default config