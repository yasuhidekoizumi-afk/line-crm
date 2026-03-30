import type { NextConfig } from 'next'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))

const isGitHubPages = process.env.GITHUB_PAGES === 'true'

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@line-crm/shared'],
  basePath: isGitHubPages ? '/line-crm' : '',
  assetPrefix: isGitHubPages ? '/line-crm/' : '',
  env: {
    APP_VERSION: pkg.version,
  },
}
export default nextConfig
