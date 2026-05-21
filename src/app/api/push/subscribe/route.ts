/**
 * POST /api/push/subscribe
 *
 * Body: { subscription: PushSubscriptionJSON }
 * Returns: { ok: true }
 *
 * Stores the client's PushSubscription so the daily-verse cron can fan out
 * notifications to it. Rate-limited per-IP to keep this endpoint cheap.
 *
 * Validates the subscription shape manually (no zod dep) — we only need
 * endpoint (https URL) + keys.p256dh + keys.auth (base64 strings).
 */

import { addSubscription } from '@/lib/push-server';
import { clientKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// 10/min per IP — generous enough for repeated reconnects, tight enough
// to keep a scripted attacker from filling /tmp/jaisus-push.json.
const SUBSCRIBE_LIMIT = { capacity: 10, refillRatePerSec: 10 / 60 };

function isBase64Like(s: unknown): s is string {
  // base64 / base64url chars — we accept both since browsers vary.
  return typeof s === 'string' && /^[A-Za-z0-9+/_=-]+$/.test(s) && s.length > 0;
}

function isValidSubscription(value: unknown): value is PushSubscriptionJSON {
  if (!value || typeof value !== 'object') return false;
  const sub = value as Record<string, unknown>;
  if (typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) {
    return false;
  }
  const keys = sub.keys;
  if (!keys || typeof keys !== 'object') return false;
  const k = keys as Record<string, unknown>;
  return isBase64Like(k.p256dh) && isBase64Like(k.auth);
}

export async function POST(req: Request) {
  const rl = rateLimit(`push-subscribe:${clientKey(req)}`, SUBSCRIBE_LIMIT);
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

  const subscription = (body as { subscription?: unknown } | null)?.subscription;
  if (!isValidSubscription(subscription)) {
    return new Response(
      JSON.stringify({ error: 'Invalid subscription shape' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  await addSubscription(subscription);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
