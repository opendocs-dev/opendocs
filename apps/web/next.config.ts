import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @opendocs/core ships TypeScript source (a file: dependency), so Next must compile it.
  transpilePackages: ['@opendocs/core'],
  // No rewrites here: /api is proxied at runtime by app/api/[...path]/route.ts so API_ORIGIN is not baked at build.
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
