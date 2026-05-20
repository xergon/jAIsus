import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Aggressive no-cache for HTML — prevents mobile Safari and iOS PWAs from
  // serving stale builds. Static assets (_next/static) are content-hashed by
  // Next.js so they keep their own immutable caching (this only affects HTML).
  //
  // Headers explained:
  // - no-store: NEVER cache, anywhere (browser, CDN, proxy)
  // - no-cache: must revalidate before use (defense in depth with no-store)
  // - must-revalidate: stale responses must NOT be served
  // - proxy-revalidate: same as must-revalidate but for shared caches (CDN)
  // - max-age=0: response is immediately stale
  // - s-maxage=0: defeats Vercel's edge CDN cache (overrides max-age for shared caches)
  headers: async () => [
    {
      source: '/',
      headers: [
        {
          key: 'Cache-Control',
          value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
        },
        // HTTP/1.0 fallback — some older Safari versions still respect this
        { key: 'Pragma', value: 'no-cache' },
        { key: 'Expires', value: '0' },
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
