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

// Hard caps so a malicious client can't fill /tmp/jaisus-push.json with a
// multi-megabyte endpoint URL or key blob. Real values: endpoint ~150-500
// chars, p256dh ~88 chars, auth ~24 chars. The caps below leave generous
// headroom for vendor-specific URLs (FCM tokens can be ~200 chars) but
// reject obvious junk.
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 256;

function isBase64Like(s: unknown, maxLength: number): s is string {
  if (typeof s !== 'string' || s.length === 0 || s.length > maxLength) return false;
  // Browsers emit either pure base64 (with +/= chars) OR pure base64url
  // (with -_ chars). Mixing the two alphabets in the same string is a
  // signal of corruption/injection — that string can't possibly decode to
  // valid key material and would silently fail downstream during RFC 8291
  // encryption, dropping the push for that subscription on every send.
  const isStandardBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(s);
  const isBase64Url = /^[A-Za-z0-9_-]+={0,2}$/.test(s);
  return isStandardBase64 || isBase64Url;
}

function isValidSubscription(value: unknown): value is PushSubscriptionJSON {
  if (!value || typeof value !== 'object') return false;
  const sub = value as Record<string, unknown>;
  if (
    typeof sub.endpoint !== 'string' ||
    !sub.endpoint.startsWith('https://') ||
    sub.endpoint.length > MAX_ENDPOINT_LENGTH
  ) {
    return false;
  }
  const keys = sub.keys;
  if (!keys || typeof keys !== 'object') return false;
  const k = keys as Record<string, unknown>;
  return isBase64Like(k.p256dh, MAX_KEY_LENGTH) && isBase64Like(k.auth, MAX_KEY_LENGTH);
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
