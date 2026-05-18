import type { NextConfig } from 'next'

const isGitHubPages = process.env.GITHUB_PAGES === 'true'
const hasCustomDomain = process.env.CUSTOM_DOMAIN === 'true'

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@line-crm/shared'],
  basePath: isGitHubPages && !hasCustomDomain ? '/line-crm' : '',
  assetPrefix: isGitHubPages && !hasCustomDomain ? '/line-crm/' : '',
  typescript: {
    ignoreBuildErrors: true,
  },
}
export default nextConfig
