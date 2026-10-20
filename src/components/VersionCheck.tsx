'use client';

import { useEffect, useRef } from 'react';
import { toast } from '@/lib/toast';

interface VersionCheckProps {
  /** Build ID embedded at SSR — compared against /api/version on focus events */
  buildId: string;
}

/**
 * Fixes iOS PWAs serving stale builds.
 *
 * iOS Safari (especially as a homescreen PWA) aggressively caches HTML even with
 * no-store headers, because it treats homescreen apps as offline-first. The result:
 * users open the app days after a deploy and see the old version, with no way to
 * force a refresh except quitting Safari completely.
 *
 * This component checks the server's current build ID whenever the app becomes
 * visible (tab focus, return from background, etc.) and force-reloads if it has
 * changed since the page was rendered. The reload only happens right away when
 * the user is just arriving (page load, or returning to the app). A new build
 * found while the app is in use (5-minute poll, window focus) waits for the
 * next return to the app, with a "Refresh" toast in the meantime, so it never
 * cuts off a reply, the mic, the camera or a half-typed message.
 *
 * Renders nothing.
 */
// Reload-loop circuit-breaker. If the same session triggers more than this
// many reloads, stop trying — something is wrong (CDN serving stale
// /api/version, SW intercepting the reload, etc.) and we shouldn't keep
// looping forever. Audit fix: was unlimited.
const MAX_RELOADS_PER_SESSION = 3;
const RELOAD_COUNTER_KEY = 'jaisus-version-reload-count';
// Throttle floor for focus/visibility-triggered checks. iOS Safari's focus
// bounce can fire 2–3 times per second on some devices; we don't want to
// hammer /api/version that fast. Audit fix.
const MIN_CHECK_INTERVAL_MS = 10_000;
// A focus-triggered check this soon after the page became visible still counts
// as the user arriving (iOS fires focus and visibilitychange together).
const ARRIVAL_WINDOW_MS = 5_000;

type CheckTrigger = 'mount' | 'visible' | 'focus' | 'interval';

export function VersionCheck({ buildId }: VersionCheckProps) {
  const reloadingRef = useRef(false);
  const lastCheckAtRef = useRef(0);
  const pendingReloadRef = useRef(false);
  const arrivedAtRef = useRef(0);

  useEffect(() => {
    // 'dev' build IDs only happen in local dev — skip the check
    if (!buildId || buildId === 'dev') return;

    arrivedAtRef.current = Date.now();

    // Drop the cache-busting param left by a previous version reload.
    try {
      const current = new URL(window.location.href);
      if (current.searchParams.has('_v')) {
        current.searchParams.delete('_v');
        window.history.replaceState(null, '', current.pathname + current.search + current.hash);
      }
    } catch { /* */ }

    async function reload(latest: string | undefined) {
      if (reloadingRef.current) return;
      // Audit fix: circuit-breaker. If this session has already reloaded
      // MAX_RELOADS_PER_SESSION times without succeeding, the loop is
      // pathological — stop and let the user manually refresh.
      let reloadCount = 0;
      try {
        reloadCount = parseInt(sessionStorage.getItem(RELOAD_COUNTER_KEY) || '0', 10) || 0;
      } catch { /* sessionStorage unavailable */ }
      if (reloadCount >= MAX_RELOADS_PER_SESSION) {
        console.warn('[VersionCheck] Reload-loop circuit broken — giving up after', reloadCount, 'attempts');
        reloadingRef.current = true;
        return;
      }
      try { sessionStorage.setItem(RELOAD_COUNTER_KEY, String(reloadCount + 1)); } catch { /* */ }

      reloadingRef.current = true;
      console.log('[VersionCheck] New build detected — reloading', { current: buildId, latest, attempt: reloadCount + 1 });

      // Audit fix: also kick the service worker so a waiting / stale
      // worker doesn't intercept the reload and re-serve the old HTML.
      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            await reg.update();
            if (reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          }
        }
      } catch { /* */ }

      // Cache-busting reload: hard navigate to a URL with a timestamp param,
      // which iOS Safari is more likely to actually fetch fresh
      const url = new URL(window.location.href);
      url.searchParams.set('_v', String(Date.now()));
      window.location.replace(url.toString());
    }

    async function check(trigger: CheckTrigger) {
      if (reloadingRef.current) return;
      // Audit fix: throttle to MIN_CHECK_INTERVAL_MS. focus + visibilitychange
      // can each fire several times per second on iOS; we don't need that
      // many round-trips to /api/version.
      const now = Date.now();
      if (now - lastCheckAtRef.current < MIN_CHECK_INTERVAL_MS) return;
      lastCheckAtRef.current = now;
      try {
        // Audit fix: cache-bust the version probe URL itself, not just the
        // request cache. iOS Safari's PWA cache layer occasionally ignores
        // `cache: 'no-store'` and can return a stale buildId, triggering
        // an infinite reload chase.
        const res = await fetch(`/api/version?_v=${now}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (data.buildId && data.buildId !== buildId) {
          const arriving =
            trigger === 'mount' ||
            trigger === 'visible' ||
            (trigger === 'focus' && Date.now() - arrivedAtRef.current < ARRIVAL_WINDOW_MS);
          if (!arriving) {
            // The user may be mid-conversation: reload on their next return
            // to the app, or now if they tap Refresh.
            if (!pendingReloadRef.current) {
              pendingReloadRef.current = true;
              const latest = data.buildId;
              toast('A new version of jAIsus is ready.', {
                duration: 0,
                action: { label: 'Refresh', onClick: () => { void reload(latest); } },
              });
            }
            return;
          }
          await reload(data.buildId);
        } else if (data.buildId === buildId) {
          // We're current — clear the loop counter so future legitimate
          // upgrades aren't blocked.
          try { sessionStorage.removeItem(RELOAD_COUNTER_KEY); } catch { /* */ }
        }
      } catch {
        // Network errors are fine — try again next time
      }
    }

    // Check immediately on mount (in case the page was served from cache).
    // The throttle has a 0 baseline so this initial call always runs.
    check('mount');

    // Check whenever the app becomes visible — covers iOS PWAs returning from
    // background, browser tab switching, etc.
    function onVisibility() {
      if (document.visibilityState !== 'visible') return;
      arrivedAtRef.current = Date.now();
      // A build found while the app was in use is applied now, without
      // another fetch (the throttle could swallow it).
      if (pendingReloadRef.current) {
        void reload(undefined);
        return;
      }
      check('visible');
    }
    const onFocus = () => check('focus');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    // Also poll every 5 minutes for users who keep the app open
    const interval = setInterval(() => check('interval'), 5 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [buildId]);

  return null;
}
