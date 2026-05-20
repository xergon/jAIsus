'use client';

import { useEffect, useRef } from 'react';

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
 * changed since the page was rendered.
 *
 * Renders nothing.
 */
export function VersionCheck({ buildId }: VersionCheckProps) {
  const reloadingRef = useRef(false);

  useEffect(() => {
    // 'dev' build IDs only happen in local dev — skip the check
    if (!buildId || buildId === 'dev') return;

    async function check() {
      if (reloadingRef.current) return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (data.buildId && data.buildId !== buildId) {
          reloadingRef.current = true;
          console.log('[VersionCheck] New build detected — reloading', { current: buildId, latest: data.buildId });
          // Cache-busting reload: hard navigate to a URL with a timestamp param,
          // which iOS Safari is more likely to actually fetch fresh
          const url = new URL(window.location.href);
          url.searchParams.set('_v', String(Date.now()));
          window.location.replace(url.toString());
        }
      } catch {
        // Network errors are fine — try again next time
      }
    }

    // Check immediately on mount (in case the page was served from cache)
    check();

    // Check whenever the app becomes visible — covers iOS PWAs returning from
    // background, browser tab switching, etc.
    function onVisibility() {
      if (document.visibilityState === 'visible') check();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', check);

    // Also poll every 5 minutes for users who keep the app open
    const interval = setInterval(check, 5 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', check);
      clearInterval(interval);
    };
  }, [buildId]);

  return null;
}
