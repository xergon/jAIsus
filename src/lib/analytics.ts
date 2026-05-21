/**
 * Privacy-first client-side analytics.
 *
 * Design goals (in order):
 *  1. Privacy. No message content, no audio, no scene descriptions, no PII.
 *     No client-side fingerprinting (UA / IP / device). The server may add an
 *     IP if it wants to — that's its call — but we don't ship one.
 *  2. Cheap. Module-level buffer, no React state, no external deps.
 *  3. Silent. If `/api/analytics` doesn't exist yet, returns 404, or the user
 *     is offline, we drop the events and move on. Analytics must never break
 *     the app.
 *
 * Storage:
 *  - Events live in an in-memory array. We deliberately do NOT use
 *    localStorage/sessionStorage — that would survive across sessions and make
 *    us answer awkward questions about retention. Session-only is simpler.
 *
 * Delivery:
 *  - Batches flush every 5s after the most recent `track()` (debounced timer).
 *  - On `visibilitychange` (hidden) and `pagehide` we force-flush via
 *    `navigator.sendBeacon` — the only API that reliably ships data during
 *    page unload. `fetch({ keepalive: true })` is the fallback.
 *  - No retries. Lost is lost. (Privacy + simplicity over completeness.)
 *
 * Opt-out:
 *  - `disable()` for explicit user opt-out.
 *  - `navigator.doNotTrack === '1'` (or `window.doNotTrack === '1'`) auto-
 *    disables after `initAnalytics()` runs.
 */

const ENDPOINT = '/api/analytics';
const FLUSH_DEBOUNCE_MS = 5_000;
const MAX_BUFFER = 50;

export interface AnalyticsEvent {
  /** Event name in dot.case: 'voice.start', 'message.sent', 'panel.opened', etc. */
  name: string;
  /** Anonymous numeric/string properties only. Strict whitelist of allowed value types. */
  properties?: Record<string, string | number | boolean>;
  /** Set internally — don't pass */
  timestamp?: number;
}

// Module-level mutable state. Per the spec — kept simple on purpose.
let enabled = true;
let buffer: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

/** True if running in a browser context with the bits we need. */
function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Sanitize a properties object to the allowed value types only.
 * Anything that isn't string/number/boolean is dropped silently — we'd rather
 * lose a field than accidentally ship a nested object containing PII.
 */
function sanitizeProperties(
  properties?: AnalyticsEvent['properties']
): AnalyticsEvent['properties'] | undefined {
  if (!properties) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Track a single event. Buffered; sent in the next flush. */
export function track(name: string, properties?: AnalyticsEvent['properties']): void {
  if (!enabled || !hasWindow()) return;

  const event: AnalyticsEvent = {
    name,
    properties: sanitizeProperties(properties),
    timestamp: Date.now(),
  };

  buffer.push(event);

  // FIFO cap. Drop the oldest if we're over the cap — keeps memory bounded
  // even if the network is wedged and flushes keep failing.
  if (buffer.length > MAX_BUFFER) {
    buffer.splice(0, buffer.length - MAX_BUFFER);
  }

  // Debounced flush: reset the timer on every track().
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    // Swallow the promise — caller doesn't care.
    void flush();
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * Force-flush the buffer immediately. Returns when the send is dispatched
 * (or silently fails). No retries.
 */
export async function flush(): Promise<void> {
  if (!hasWindow()) return;

  // Snapshot + clear first so concurrent track() calls don't get caught up
  // in the in-flight send.
  const snapshot = buffer;
  if (snapshot.length === 0) return;
  buffer = [];
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const payload = JSON.stringify({ events: snapshot });

  try {
    // sendBeacon is the right tool for page-unload flushes: fire-and-forget,
    // works after the page is gone, and bypasses the network throttling the
    // browser applies to in-flight fetches during unload.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      // If sendBeacon refuses (e.g., payload too large), fall through to fetch.
      if (ok) return;
    }

    // Fallback: fetch with keepalive so the request can outlive the page.
    if (typeof fetch === 'function') {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {
        /* swallow — 404 / network / CORS all OK to drop */
      });
    }
  } catch {
    // Analytics never break the app. Events are lost; that's by design.
  }
}

/** Disable analytics entirely for this session. Also wipes any buffered events. */
export function disable(): void {
  enabled = false;
  buffer = [];
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/** Re-enable analytics. Default state at module load. */
export function enable(): void {
  enabled = true;
}

/** Whether analytics is currently active. */
export function isEnabled(): boolean {
  return enabled;
}

/**
 * Wire up page-lifecycle flush handlers. Call once at app startup.
 * Idempotent — repeat calls are no-ops.
 *
 * Also honors Do Not Track: if the browser signals DNT, we auto-disable.
 */
export function initAnalytics(): void {
  if (initialized || !hasWindow()) return;
  initialized = true;

  // Honor Do Not Track. Checked here (not at module load) so SSR doesn't
  // touch window/navigator.
  type DNTHost = { doNotTrack?: string | null };
  const navDNT = (navigator as unknown as DNTHost).doNotTrack;
  const winDNT = (window as unknown as DNTHost).doNotTrack;
  if (navDNT === '1' || winDNT === '1') {
    disable();
  }

  // Best-effort flush when the page becomes hidden — mobile Safari often
  // fires `visibilitychange` but not `pagehide`/`beforeunload` on tab swap.
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush();
  };
  document.addEventListener('visibilitychange', onHide);

  // `pagehide` is the modern unload event — fires on real navigations and
  // bfcache stashing. We don't use `beforeunload` (it interferes with bfcache).
  window.addEventListener('pagehide', () => {
    void flush();
  });
}
