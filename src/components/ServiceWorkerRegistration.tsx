'use client';

import { useEffect } from 'react';
import { SW_PATH } from '@/lib/sw-config';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Don't register in development — it confuses HMR.
    if (process.env.NODE_ENV !== 'production') return;

    // Wait for the page to be idle before registering, so the SW doesn't compete
    // for resources during the critical first paint.
    const register = () => {
      navigator.serviceWorker.register(SW_PATH, { scope: '/' })
        .then(reg => {
          console.log('Service worker registered:', reg.scope);

          // Audit fix: wire up the full update flow. Previously VersionCheck
          // tried to detect new builds and reload, but no one was telling a
          // *waiting* SW to skip-wait — on iOS PWAs that rarely close all
          // tabs, the new worker could sit in "waiting" forever.
          //
          // Flow:
          //  1. `updatefound` fires when a new SW is downloading.
          //  2. Once it transitions to `installed` AND we already have an
          //     active controller, that means an UPDATE (not a first-time
          //     install). Tell the new worker to skip waiting.
          //  3. `controllerchange` fires when the new SW takes over; we let
          //     VersionCheck handle the page reload (don't double-reload).
          const tryActivateWaiting = () => {
            if (reg.waiting && navigator.serviceWorker.controller) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          };
          // If a worker is already waiting at registration time, kick it.
          tryActivateWaiting();
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });

          // Periodic update check — same cadence as VersionCheck. This
          // forces the browser to re-fetch sw.js, which is how a new
          // worker gets discovered for an iOS PWA that never closes.
          const updateInterval = setInterval(() => {
            reg.update().catch(() => { /* offline / blip */ });
          }, 5 * 60 * 1000);
          // Note: this interval is intentionally not cleared — the
          // component mounts once at the app root and stays for the
          // page lifetime. Returning from useEffect would clear it but
          // would also cancel updates the moment the layout re-renders.
          void updateInterval;
        })
        .catch(err => {
          console.warn('Service worker registration failed:', err);
        });
    };

    // Use requestIdleCallback if available, otherwise a short timeout.
    // Audit fix: pass a timeout so we don't hang forever waiting for idle
    // on a media-heavy app (video + audio playing means the main thread
    // is rarely idle for long enough to satisfy idle without a deadline).
    if ('requestIdleCallback' in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void })
        .requestIdleCallback(register, { timeout: 3000 });
    } else {
      setTimeout(register, 1500);
    }
  }, []);

  return null;
}
