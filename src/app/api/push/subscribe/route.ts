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
 * endpoint (https URL on a known push service) + keys.p256dh + keys.auth
 * (base64 strings that decode to a P-256 point and a 16-byte secret).
 * Returns 503 when the store is full, so the client doesn't treat it as done.
 */

import { addSubscription, isAllowedPushEndpoint } from '@/lib/push-server';
import { clientKey, rateLimitAsync, rateLimitResponse } from '@/lib/rate-limit';

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

// A real request is well under 1 KB. Checked on the raw text before parsing,
// since content-length can be missing — the parsed body used to be stored
// whole, so a multi-MB extra field went straight into memory and /tmp.
const MAX_BODY_LENGTH = 8192;

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

/** Decoded byte length of a base64 or base64url string. */
function decodedBytes(s: string): Buffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  return Buffer.from(b64 + '==='.slice((b64.length + 3) % 4), 'base64');
}

function isValidSubscription(value: unknown): value is PushSubscriptionJSON {
  if (!value || typeof value !== 'object') return false;
  const sub = value as Record<string, unknown>;
  // Known push services only: the cron POSTs to this URL (SSRF guard).
  if (
    typeof sub.endpoint !== 'string' ||
    sub.endpoint.length > MAX_ENDPOINT_LENGTH ||
    !isAllowedPushEndpoint(sub.endpoint)
  ) {
    return false;
  }
  const keys = sub.keys;
  if (!keys || typeof keys !== 'object') return false;
  const k = keys as Record<string, unknown>;
  if (!isBase64Like(k.p256dh, MAX_KEY_LENGTH) || !isBase64Like(k.auth, MAX_KEY_LENGTH)) {
    return false;
  }
  // Check decoded sizes, not string length: p256dh is an uncompressed P-256
  // point (65 bytes, 0x04 first), auth a 16-byte secret. Anything else can
  // never be encrypted for and would fail on every cron run.
  const p256dh = decodedBytes(k.p256dh);
  return p256dh.length === 65 && p256dh[0] === 0x04 && decodedBytes(k.auth).length === 16;
}

export async function POST(req: Request) {
  // Async (Upstash when configured): the in-memory bucket resets per
  // instance, and every accepted call writes to the store.
  const rl = await rateLimitAsync(`push-subscribe:${clientKey(req)}`, SUBSCRIBE_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_LENGTH) {
      return new Response(JSON.stringify({ error: 'Body too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    body = JSON.parse(text);
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

  // Store a clean copy — never the client's object with whatever else it carried.
  const stored = await addSubscription({
    endpoint: subscription.endpoint,
    expirationTime: typeof subscription.expirationTime === 'number' ? subscription.expirationTime : null,
    keys: { p256dh: subscription.keys!.p256dh, auth: subscription.keys!.auth },
  });
  if (!stored) {
    return new Response(JSON.stringify({ error: 'Subscription store full' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
