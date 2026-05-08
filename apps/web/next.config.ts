import type { NextConfig } from 'next'

const isGitHubPages = process.env.GITHUB_PAGES === 'true'

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@line-crm/shared'],
  basePath: isGitHubPages ? '/line-crm' : '',
  assetPrefix: isGitHubPages ? '/line-crm/' : '',
  typescript: {
    ignoreBuildErrors: true,
  },
}
export default nextConfig
