import type { NextConfig } from 'next';
import path from 'node:path';

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
  outputFileTracingRoot: path.join(__dirname, '../..'),
  outputFileTracingIncludes: {
    '/**': ['./node_modules/.prisma/client/**', '../../node_modules/.prisma/client/**'],
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
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
