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
 * is safe to share. Disk writes are best-effort and may be racy under burst
 * subscribes — we accept that since the source of truth on next read is
 * whatever's on disk.
 */

import { promises as fs } from 'fs';

const STORE_PATH = process.env.PUSH_STORE_PATH || '/tmp/jaisus-push.json';

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
      const raw = await fs.readFile(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as PushSubscriptionJSON[];
      if (Array.isArray(parsed)) {
        for (const sub of parsed) {
          if (sub && typeof sub.endpoint === 'string') {
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

async function persistToDisk(): Promise<void> {
  try {
    const arr = Array.from(subscriptions.values());
    // Audit fix: atomic write via tmp+rename. fs.writeFile is not atomic —
    // a function killed mid-write leaves a half-written JSON file, which
    // the next loadFromDisk's JSON.parse silently swallows, dropping every
    // subscription on the next read.
    const tmpPath = STORE_PATH + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(arr), 'utf8');
    await fs.rename(tmpPath, STORE_PATH);
  } catch {
    // Read-only filesystem or quota — log-and-continue. The in-memory Map
    // is still authoritative for the lifetime of this instance.
    // (Intentionally silent: every mutation would log otherwise; the cron
    // handler doesn't care.)
  }
}

/** Add or replace a subscription (keyed by endpoint). */
export async function addSubscription(sub: PushSubscriptionJSON): Promise<void> {
  await loadFromDisk();
  if (!sub.endpoint) return;
  subscriptions.set(sub.endpoint, sub);
  await persistToDisk();
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
