'use client';

import { useEffect } from 'react';
import { initAnalytics, track } from '@/lib/analytics';

/**
 * Initialises the analytics flush listeners exactly once. Mounted in
 * layout.tsx so it boots with the app. Privacy-respecting — see
 * `src/lib/analytics.ts` for the data we DON'T collect.
 */
export function AnalyticsInit() {
  useEffect(() => {
    initAnalytics();
    track('app.boot');
  }, []);
  return null;
}
