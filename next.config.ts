import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent aggressive caching of HTML pages — ensures visitors always get latest build.
  // Static assets (_next/static) are content-hashed by Next.js so they're fine to cache.
  headers: async () => [
    {
      source: '/',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, must-revalidate' },
      ],
    },
  ],
};

export default nextConfig;
