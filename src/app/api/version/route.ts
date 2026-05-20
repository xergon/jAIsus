/**
 * Returns the current deployed build ID.
 *
 * The client polls this on focus/visibility-change and compares to the build ID
 * embedded in the page at render time. If they differ, a new deploy is live and
 * the client reloads to pick it up — fixes iOS PWAs serving stale builds.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
  return new Response(JSON.stringify({ buildId }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, s-maxage=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}
