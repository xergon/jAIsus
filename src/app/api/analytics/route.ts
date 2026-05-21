/**
 * Analytics ingestion stub.
 *
 * `src/lib/analytics.ts` POSTs batched events here via `navigator.sendBeacon`
 * (with `fetch keepalive` fallback). Before this route existed, every flush
 * silently 404'd — wasted requests + log noise on every page hide.
 *
 * For now we accept-and-drop. Returns 204 (no content) so clients don't
 * complain. When the user wants real analytics they can swap the body of
 * this handler for a write to Vercel KV, Postgres, or an external provider
 * — the wire format from the client is already JSON `{ events: AnalyticsEvent[] }`.
 *
 * Rate-limited to prevent a runaway client from flooding logs.
 */
import { clientKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 5;

// Generous bucket — analytics is auto-batched every 5s + on pagehide. 60-burst
// covers a long single session; 1-per-sec sustained covers normal use.
const ANALYTICS_LIMIT = { capacity: 60, refillRatePerSec: 1 };

export async function POST(req: Request) {
  const rl = rateLimit(`analytics:${clientKey(req)}`, ANALYTICS_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  // We accept the body but don't process it yet — see the comment at the top
  // for the next-step migration to durable storage. Reading body to drain
  // (sendBeacon needs a successful read or it logs a warning).
  try {
    await req.text();
  } catch {
    // sendBeacon can send weird payloads; silently accept.
  }

  return new Response(null, { status: 204 });
}
