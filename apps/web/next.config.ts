import type { NextConfig } from 'next';
import { apiRewrites } from './lib/rewrites';

const nextConfig: NextConfig = {
  // @opendocs/core ships TypeScript source (a file: dependency), so Next must compile it.
  transpilePackages: ['@opendocs/core'],
  async rewrites() {
    return apiRewrites();
  },
  async headers() {
    return [
      {
        source: '/d/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
