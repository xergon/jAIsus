/**
 * Lightweight in-memory rate limiter for paid AI endpoints.
 *
 * Uses a token bucket per client identifier (IP). Adequate for a small personal
 * app on Vercel Fluid Compute — instances are reused, so the bucket state
 * persists across requests on the same function instance. Limitations:
 *  - Buckets reset when a function instance is cold-started or replaced.
 *  - Multi-region or multi-instance fanout will let users multiply their quota.
 *
 * If/when this gets serious traffic, swap for @upstash/ratelimit or Vercel's
 * built-in firewall rules. The shape of `rateLimit()` is stable so callers
 * won't need to change.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

// Periodic cleanup of stale buckets to bound memory.
// Runs on first import; safe to set up at module level since it's a global Map.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let cleanupHandle: ReturnType<typeof setInterval> | null = null;
function ensureCleanup() {
  if (cleanupHandle) return;
  cleanupHandle = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      // Drop buckets idle for >30 min
      if (now - b.lastRefill > 30 * 60 * 1000) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for this timer (Node Vercel runtime)
  if (typeof cleanupHandle === 'object' && cleanupHandle && 'unref' in cleanupHandle) {
    (cleanupHandle as unknown as { unref: () => void }).unref();
  }
}

export interface RateLimitConfig {
  /** Max requests in the burst window */
  capacity: number;
  /** Tokens added per second (steady-state allowance) */
  refillRatePerSec: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the next token is available (0 if request allowed) */
  retryAfterSec: number;
  /** Remaining tokens in the bucket after this call */
  remaining: number;
}

/**
 * Attempt to consume one token for `key` (typically an IP).
 *
 * Returns `{ ok: true }` if the request can proceed, or `{ ok: false, retryAfterSec }`
 * if the bucket is empty.
 */
export function rateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  ensureCleanup();
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: config.capacity, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Refill based on elapsed time
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(config.capacity, bucket.tokens + elapsed * config.refillRatePerSec);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    const retryAfterSec = Math.ceil((1 - bucket.tokens) / config.refillRatePerSec);
    return { ok: false, retryAfterSec, remaining: 0 };
  }

  bucket.tokens -= 1;
  return { ok: true, retryAfterSec: 0, remaining: Math.floor(bucket.tokens) };
}

/**
 * Best-effort client identifier from a request.
 *
 * Trusts X-Forwarded-For / x-real-ip from Vercel's edge, which is appropriate
 * here since these routes run behind Vercel and the headers are set by the
 * platform (not user-controlled).
 */
export function clientKey(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = req.headers.get('x-real-ip');
  if (xri) return xri;
  return 'unknown';
}

/**
 * Build a 429 response with the standard Retry-After header.
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded', retryAfterSec: result.retryAfterSec }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfterSec),
      },
    }
  );
}
