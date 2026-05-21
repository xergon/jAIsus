import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No-cache for HTML — prevents mobile Safari and iOS PWAs from serving stale
  // builds. Static assets (_next/static) are content-hashed by Next.js so they
  // keep their own immutable caching (this only affects HTML).
  //
  // `no-store` is the strongest directive and implies the others (no-cache,
  // must-revalidate, max-age=0). It also applies to shared caches like Vercel's
  // edge CDN, so s-maxage isn't needed either.
  headers: async () => [
    {
      source: '/',
      headers: [
        { key: 'Cache-Control', value: 'no-store' },
      ],
    },
  ],

  // Expose a stable build ID so the client can detect when a new version is deployed
  // (used by VersionCheck component to force-reload stale iOS PWAs).
  generateBuildId: async () => {
    return process.env.VERCEL_GIT_COMMIT_SHA || `build-${Date.now()}`;
  },
};

export default nextConfig;
