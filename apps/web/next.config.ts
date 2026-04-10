import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@harbor/ui',
    '@harbor/types',
    '@harbor/utils',
    '@harbor/config',
    '@harbor/database',
    '@harbor/providers',
    '@harbor/realtime',
    '@harbor/auth',
  ],
  serverExternalPackages: ['sharp', 'bcryptjs', 'bullmq'],
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Externalize sharp and its optional platform-specific dependencies
      // to prevent webpack from trying to bundle them
      config.externals = config.externals || [];
      const sharpExternals = [
        'sharp',
        '@img/sharp-darwin-arm64',
        '@img/sharp-darwin-x64',
        '@img/sharp-linux-x64',
        '@img/sharp-linux-arm64',
        '@img/sharp-wasm32',
        '@img/sharp-libvips-dev',
        '@img/sharp-libvips-darwin-arm64',
        '@img/sharp-libvips-darwin-x64',
        '@img/sharp-libvips-linux-x64',
        '@img/sharp-libvips-linux-arm64',
      ];
      if (Array.isArray(config.externals)) {
        config.externals.push(({ request }: { request?: string }, callback: (err: null, result?: string) => void) => {
          if (request && sharpExternals.some((ext) => request.startsWith(ext))) {
            return callback(null, `commonjs ${request}`);
          }
          callback(null);
        });
      }
    }
    return config;
  },
};

export default nextConfig;
