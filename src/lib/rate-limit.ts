/**
 * Rate limiting for paid AI endpoints.
 *
 * Two implementations live side-by-side:
 *
 *  1. `rateLimit(key, config)` — synchronous, in-memory token bucket. Adequate
 *     for a single Vercel Fluid Compute instance; state persists across
 *     requests on the same function instance. Limitations:
 *       - Buckets reset when a function instance is cold-started or replaced.
 *       - Multi-region or multi-instance fanout will let users multiply their
 *         quota.
 *
 *  2. `rateLimitAsync(key, config)` — distributed, Upstash Redis-backed when
 *     the env vars `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are
 *     set. Uses a fixed-window approximation (window seconds = capacity /
 *     refillRatePerSec). Falls back to the in-memory bucket above when:
 *       - The env vars are missing (local dev), OR
 *       - The Upstash request fails / times out (network error, Upstash down).
 *     A single console.warn is emitted the first time fallback is triggered.
 *
 * Migration: to opt a route into distributed limits, swap
 *   `const rl = rateLimit(key, config)`
 * for
 *   `const rl = await rateLimitAsync(key, config)`.
 * The result shape is identical, so `rateLimitResponse(rl)` keeps working.
 *
 * Env vars (read at module load):
 *   UPSTASH_REDIS_REST_URL    e.g. https://xxxxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN  Upstash REST bearer token
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

// ---------------------------------------------------------------------------
// Upstash-backed distributed limiter
// ---------------------------------------------------------------------------

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const upstashAvailable = !!(UPSTASH_URL && UPSTASH_TOKEN);

/** 1-second cap so a slow Upstash never blocks the real request. */
const UPSTASH_TIMEOUT_MS = 1000;

let fallbackWarned = false;
function warnFallbackOnce(reason: string) {
  if (fallbackWarned) return;
  fallbackWarned = true;
  console.warn(`[rate-limit] Upstash unavailable, falling back to in-memory: ${reason}`);
}

/**
 * Shape returned by Upstash's /pipeline endpoint: an array of one
 * `{ result }` object per command, in the same order as the request body.
 * Errors come back as `{ error: "..." }` for the individual command.
 */
type UpstashPipelineEntry = { result?: unknown; error?: string };

/**
 * Execute an Upstash pipeline. Returns the parsed array on success, or `null`
 * on any failure (network, timeout, non-2xx, malformed JSON, command-level
 * error). Caller falls back to the in-memory limiter on null.
 */
async function upstashPipeline(commands: string[][]): Promise<UpstashPipelineEntry[] | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
      // Avoid Next.js fetch caching; this is a mutating call.
      cache: 'no-store',
    });
    if (!res.ok) {
      warnFallbackOnce(`HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as UpstashPipelineEntry[];
    if (!Array.isArray(data)) {
      warnFallbackOnce('malformed response');
      return null;
    }
    for (const entry of data) {
      if (entry && typeof entry === 'object' && 'error' in entry && entry.error) {
        warnFallbackOnce(`command error: ${entry.error}`);
        return null;
      }
    }
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnFallbackOnce(msg);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Distributed rate limiter. Uses Upstash Redis when configured, else falls
 * back to the in-memory token bucket.
 *
 * Window math: a fixed window of `capacity / refillRatePerSec` seconds allows
 * `capacity` requests per window. e.g. `{ capacity: 30, refillRatePerSec: 1 }`
 * → 30-second window, 30 requests allowed. This is a sliding-window
 * approximation — at window boundaries a client can briefly see up to 2x
 * capacity, which is acceptable for these endpoints.
 *
 * Atomicity: uses an Upstash pipeline of `[INCR, EXPIRE]`. The INCR returns
 * the post-increment count; EXPIRE is set every call (harmless idempotent
 * refresh — TTL stays bounded by the window length).
 *
 * Returns the same shape as `rateLimit()` so `rateLimitResponse()` works
 * unchanged.
 */
export async function rateLimitAsync(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  if (!upstashAvailable) {
    return rateLimit(key, config);
  }

  const windowSec = Math.max(1, Math.ceil(config.capacity / config.refillRatePerSec));
  const now = Date.now();
  const windowIndex = Math.floor(now / (windowSec * 1000));
  const redisKey = `rl:${key}:${windowIndex}`;

  const data = await upstashPipeline([
    ['INCR', redisKey],
    ['EXPIRE', redisKey, String(windowSec)],
  ]);

  if (!data || data.length < 1 || typeof data[0].result !== 'number') {
    // Any failure → fall back to in-memory limiter. Warning already logged
    // by upstashPipeline on the first failure.
    return rateLimit(key, config);
  }

  const count = data[0].result as number;
  const remaining = Math.max(0, config.capacity - count);
  const windowEndMs = (windowIndex + 1) * windowSec * 1000;
  const retryAfterSec = Math.max(1, Math.ceil((windowEndMs - now) / 1000));

  if (count > config.capacity) {
    return { ok: false, retryAfterSec, remaining: 0 };
  }
  return { ok: true, retryAfterSec: 0, remaining };
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
