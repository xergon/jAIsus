/**
 * Server-side subscription storage.
 *
 * MVP storage: an in-memory `Map<endpoint, PushSubscriptionJSON>` mirrored to
 * a JSON file on disk (default `/tmp/jaisus-push.json` on Vercel — the only
 * writable path in their function runtime). The file gives us best-effort
 * persistence across warm restarts on the same instance.
 *
 * TODO(prod): Migrate to a real durable store before scale. Good options:
 *   - Vercel KV (Redis) — minimal code change, fits this Map shape exactly
 *   - Upstash Redis — same
 *   - Postgres / Supabase — if we ever want user-account scoping
 * The in-memory + /tmp approach will:
 *   - Lose subscriptions across cold starts on a fresh instance
 *   - Diverge across regions (each instance has its own /tmp)
 *   - Not survive function-pool rotation
 * Acceptable for an MVP with a handful of opted-in users; not for general
 * release.
 *
 * Concurrency: Node module loading is per-instance and synchronous; the Map
 * is safe to share. Disk writes go through one promise chain, each with its
 * own tmp file, so concurrent mutations (e.g. several 410 removals during
 * the cron fan-out) can't interleave into a corrupt or stale file.
 */

import { promises as fs } from 'fs';

// A constant path (the PUSH_STORE_PATH override was never set anywhere):
// a dynamic fs path made Turbopack's file tracer pull the whole project
// (public/*.mp4, next.config.ts, …) into every /api/push function. The
// turbopackIgnore comments on the fs calls below keep the tracer off them too.
const STORE_PATH = '/tmp/jaisus-push.json';

/** Hard cap on stored subscriptions so junk sign-ups can't grow the store (and the cron fan-out) without bound. */
const MAX_SUBSCRIPTIONS = 10_000;

/**
 * Push services we'll POST to. The endpoint comes from the client, so without
 * this the cron would POST to any https URL an attacker registered (SSRF).
 *   Chrome/Android/Samsung/Opera: fcm.googleapis.com (legacy android.googleapis.com)
 *   Firefox: updates.push.services.mozilla.com
 *   Safari:  web.push.apple.com
 *   Edge:    wns2-*.notify.windows.com
 */
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

/** True for an https endpoint on a known push service (exact host or a subdomain of one). */
export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string') return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (u.port !== '' && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  // Dot-suffix match: a bare endsWith would accept "evilfcm.googleapis.com.attacker".
  return PUSH_SERVICE_HOSTS.some((d) => host === d || host.endsWith('.' + d));
}

/** Only the fields Web Push needs — never whatever else a client sent along. */
function normalize(sub: unknown): PushSubscriptionJSON | null {
  if (!sub || typeof sub !== 'object') return null;
  const s = sub as { endpoint?: unknown; expirationTime?: unknown; keys?: unknown };
  const keys = (s.keys && typeof s.keys === 'object') ? s.keys as { p256dh?: unknown; auth?: unknown } : null;
  if (typeof s.endpoint !== 'string' || !keys) return null;
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  return {
    endpoint: s.endpoint,
    expirationTime: typeof s.expirationTime === 'number' ? s.expirationTime : null,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

/** Map keyed by subscription.endpoint (a URL guaranteed unique per device). */
const subscriptions = new Map<string, PushSubscriptionJSON>();
// Audit fix: previously a boolean `loaded` flag was set to true BEFORE the
// async readFile resolved. A second concurrent call would see `loaded=true`
// and proceed with an empty Map. We now cache the in-flight promise so all
// concurrent callers await the same load.
let loadPromise: Promise<void> | null = null;

function loadFromDisk(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await fs.readFile(/* turbopackIgnore: true */ STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        // Normalize on load so entries stored before the subscribe route
        // validated strictly (extra fields, padding) are cleaned up.
        for (const entry of parsed) {
          const sub = normalize(entry);
          if (sub?.endpoint && subscriptions.size < MAX_SUBSCRIPTIONS) {
            subscriptions.set(sub.endpoint, sub);
          }
        }
      }
    } catch {
      // Missing file (first run) or corrupted JSON — start empty. The next
      // mutation will rewrite the file with a valid array.
    }
  })();
  return loadPromise;
}

// Writes run one at a time. Concurrent calls used to share one fixed .tmp
// path, so interleaved writes could leave invalid JSON (every subscription
// lost on the next load), or an older snapshot could land last.
let writeChain: Promise<void> = Promise.resolve();

function persistToDisk(): Promise<void> {
  writeChain = writeChain.then(async () => {
    // Audit fix: atomic write via tmp+rename. fs.writeFile is not atomic —
    // a function killed mid-write leaves a half-written JSON file, which
    // the next loadFromDisk's JSON.parse silently swallows, dropping every
    // subscription on the next read. The tmp name is unique per write, and
    // the snapshot is taken inside the queued step so the last write always
    // reflects the latest Map.
    const tmpPath = `${STORE_PATH}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      const arr = Array.from(subscriptions.values());
      await fs.writeFile(/* turbopackIgnore: true */ tmpPath, JSON.stringify(arr), 'utf8');
      await fs.rename(/* turbopackIgnore: true */ tmpPath, /* turbopackIgnore: true */ STORE_PATH);
    } catch {
      // Read-only filesystem or quota — log-and-continue. The in-memory Map
      // is still authoritative for the lifetime of this instance.
      // (Intentionally silent: every mutation would log otherwise; the cron
      // handler doesn't care.) Never rethrow: a rejected step would skip
      // every later write in the chain.
      await fs.unlink(/* turbopackIgnore: true */ tmpPath).catch(() => {});
    }
  });
  return writeChain;
}

/**
 * Add or replace a subscription (keyed by endpoint). Only endpoint, keys and
 * expirationTime are stored. Returns false when the store is full and the
 * endpoint is new (replacing an existing one is always allowed).
 */
export async function addSubscription(sub: PushSubscriptionJSON): Promise<boolean> {
  await loadFromDisk();
  const clean = normalize(sub);
  if (!clean?.endpoint) return false;
  if (!subscriptions.has(clean.endpoint) && subscriptions.size >= MAX_SUBSCRIPTIONS) {
    return false;
  }
  subscriptions.set(clean.endpoint, clean);
  await persistToDisk();
  return true;
}

/** Remove a subscription by endpoint. No-op if it doesn't exist. */
export async function removeSubscription(endpoint: string): Promise<void> {
  await loadFromDisk();
  if (subscriptions.delete(endpoint)) {
    await persistToDisk();
  }
}

/** Snapshot of all current subscriptions. */
export async function listSubscriptions(): Promise<PushSubscriptionJSON[]> {
  await loadFromDisk();
  return Array.from(subscriptions.values());
}
