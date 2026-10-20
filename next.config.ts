import type { NextConfig } from "next";

/**
 * Security headers and cache policy.
 *
 * - HTML responses get `Cache-Control: no-store` so iOS PWAs / mobile Safari
 *   don't serve a stale shell across deploys. Scoped to ALL HTML routes
 *   (anything not under _next/static, _next/image, or with a file extension),
 *   not just `/`, so future routes like `/about` are also protected.
 * - The full standard security-header set is applied to every path:
 *     - Content-Security-Policy: same-origin + the third parties we hit
 *       (Anthropic, Google generativelanguage, ElevenLabs, Vercel /api/og)
 *     - X-Frame-Options: DENY (no embedding — jAIsus isn't an embeddable widget)
 *     - X-Content-Type-Options: nosniff
 *     - Referrer-Policy: strict-origin-when-cross-origin (no full URL leak)
 *     - Permissions-Policy: only the features we actually use
 *     - Strict-Transport-Security: 2y, includeSubDomains, preload
 *
 * `poweredByHeader: false` drops the `X-Powered-By: Next.js` fingerprint that
 * Next would otherwise advertise on every response.
 */

// CSP — careful here. We need:
//  - 'self' for our own JS/CSS/manifest
//  - 'unsafe-inline' on style-src for Tailwind JIT + animate-* inline styles
//  - 'unsafe-eval' on script-src for Next's runtime in dev (gated out in prod)
//  - data: + blob: img/media for OG cards, captured camera frames, TTS audio
//  - The three upstream API hosts we contact
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Where the client is allowed to fetch / open WebSocket connections.
  // We only need same-origin here; everything paid lives behind our /api/*.
  "connect-src 'self' https://api.elevenlabs.io https://generativelanguage.googleapis.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Allow only the device features we actually use; deny the rest.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  headers: async () => [
    {
      // Match all paths EXCEPT static asset routes + paths with a file
      // extension. This keeps `Cache-Control: no-store` on HTML responses
      // (root, error pages, any future SSR route) without affecting the
      // immutable hashed assets under /_next/static.
      source: '/((?!_next/static|_next/image|favicon\\.ico|.*\\..*).*)',
      headers: [
        { key: 'Cache-Control', value: 'no-store' },
        ...SECURITY_HEADERS,
      ],
    },
    {
      // Perf audit fix: MP4 hero videos are ~12MB each and previously served
      // with the default `public, max-age=0, must-revalidate`. That forced
      // every mobile user to re-download the video on every session even
      // though the filenames are stable. Cached for a day, then revalidated:
      // these files are not content-hashed and do get replaced in place.
      source: '/:path*.(mp4|webm|mp3|wav|png|jpg|jpeg|webp|svg|woff|woff2|ttf|otf)',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ...SECURITY_HEADERS,
      ],
    },
    {
      // Security headers for everything else (static assets, images) too,
      // minus the Cache-Control override (Next handles their caching).
      source: '/:path*',
      headers: SECURITY_HEADERS,
    },
  ],

  // Expose a stable build ID so the client can detect when a new version is deployed
  // (used by VersionCheck component to force-reload stale iOS PWAs).
  generateBuildId: async () => {
    return process.env.VERCEL_GIT_COMMIT_SHA || `build-${Date.now()}`;
  },
};

export default nextConfig;
