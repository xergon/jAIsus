/**
 * POST /api/push/unsubscribe
 *
 * Body: { endpoint: string }
 * Returns: { ok: true }
 *
 * Removes the endpoint from the subscription store. No-op if it wasn't
 * present. We don't authenticate the endpoint — the worst case is a stranger
 * passes our own endpoint and stops their own (or another user's) notifications,
 * which is the same outcome as a normal `unsubscribe` browser action. The
 * endpoint URL itself is the secret here.
 */

import { removeSubscription } from '@/lib/push-server';
import { clientKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const UNSUBSCRIBE_LIMIT = { capacity: 10, refillRatePerSec: 10 / 60 };

export async function POST(req: Request) {
  const rl = rateLimit(`push-unsubscribe:${clientKey(req)}`, UNSUBSCRIBE_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    return new Response(JSON.stringify({ error: 'Invalid endpoint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await removeSubscription(endpoint);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
