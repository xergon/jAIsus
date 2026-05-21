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
          // When a new SW takes control (after our VersionCheck triggers a reload),
          // there will be a controllerchange event — we don't need to do anything,
          // the reload already happened.
          console.log('Service worker registered:', reg.scope);
        })
        .catch(err => {
          console.warn('Service worker registration failed:', err);
        });
    };

    // Use requestIdleCallback if available, otherwise a short timeout
    if ('requestIdleCallback' in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(register);
    } else {
      setTimeout(register, 1500);
    }
  }, []);

  return null;
}
