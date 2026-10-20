import type { MetadataRoute } from 'next';

/**
 * Robots policy.
 *
 * Public pages crawlable; API routes blocked so search engines don't index
 * 401/500 responses from chat / push / cron / vision. Sitemap intentionally
 * omitted — single-page app. /api/og stays allowed: it is the og:image
 * and twitter:image, and unfurlers (X, LinkedIn, Slack) obey robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/api/og'],
        disallow: ['/api/'],
      },
    ],
  };
}
