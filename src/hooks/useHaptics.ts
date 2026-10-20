'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

/**
 * Named haptic patterns. Strings map to a duration in ms (or a vibrate
 * pattern array) when passed to `vibrate`.
 *
 * - `tap`        10ms       — a quick acknowledgment
 * - `light`      15ms       — slightly more
 * - `medium`     25ms       — confirmation
 * - `heavy`      40ms       — important state change
 * - `success`    [10,50,30] — pleasant
 * - `warning`    [30,50,30] — caution
 * - `error`      [50,80,50] — alert
 * - `doubleTap`  [10,50,10] — double feel
 */
export type HapticPattern =
  | 'tap'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error'
  | 'doubleTap';

export interface UseHapticsResult {
  vibrate: (pattern: HapticPattern | number | number[]) => void;
  isSupported: boolean;
  /** Respect prefers-reduced-motion + a user opt-out via localStorage */
  isEnabled: boolean;
  /** Manually opt out / back in, persists to localStorage */
  setEnabled: (enabled: boolean) => void;
}

const STORAGE_KEY = 'jaisus-haptics-enabled';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const PATTERNS: Readonly<Record<HapticPattern, number | number[]>> = {
  tap: 10,
  light: 15,
  medium: 25,
  heavy: 40,
  success: [10, 50, 30],
  warning: [30, 50, 30],
  error: [50, 80, 50],
  doubleTap: [10, 50, 10],
};

/**
 * Resolve a HapticPattern name (or pass-through number / number[]) to the
 * shape `navigator.vibrate` accepts.
 */
function resolvePattern(
  pattern: HapticPattern | number | number[]
): number | number[] {
  if (typeof pattern === 'string') return PATTERNS[pattern];
  return pattern;
}

// External values the hook reads through useSyncExternalStore, so the server
// and hydration render see `false` and the client then follows the real
// values without a setState-in-effect pass.
const noopSubscribe = () => () => {};
const getServerFalse = () => false;

function getVibrateSupported(): boolean {
  return typeof window.navigator !== 'undefined' && typeof window.navigator.vibrate === 'function';
}

// One MediaQueryList for all instances; the snapshot is read on every render.
let reducedMotionMql: MediaQueryList | null | undefined;
function getReducedMotionMql(): MediaQueryList | null {
  if (reducedMotionMql === undefined) {
    reducedMotionMql =
      typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
  }
  return reducedMotionMql;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const mql = getReducedMotionMql();
  if (!mql) return () => {};
  // addEventListener is the modern API; some older browsers only have
  // addListener. Guard for both.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  if (typeof mql.addListener === 'function') {
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }
  return () => {};
}

function getReducedMotion(): boolean {
  return getReducedMotionMql()?.matches ?? false;
}

// The stored opt-out follows other tabs too.
function subscribeStoredEnabled(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** The user's stored opt-out, defaulting to enabled. */
function getStoredEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored !== 'false';
  } catch {
    // localStorage can throw in private mode or when disabled — treat as
    // "no preference stored".
    return true;
  }
}

/**
 * Fire-and-forget haptic helper, safe to call from anywhere (lib code,
 * outside React, before mount, on the server). Returns a boolean indicating
 * whether the vibrate call was actually attempted — useful in tests, but
 * most callers can ignore the return value.
 *
 * Unlike the hook, this does NOT check prefers-reduced-motion or the
 * localStorage opt-out: it's intended for low-level call sites where the
 * caller has already decided. For UI components, prefer `useHaptics`.
 */
export function triggerHaptic(
  pattern: HapticPattern | number | number[]
): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator;
  if (!nav || typeof nav.vibrate !== 'function') return false;
  try {
    return nav.vibrate(resolvePattern(pattern));
  } catch {
    return false;
  }
}

/**
 * React hook for haptic feedback on mobile devices.
 *
 * Backed by `navigator.vibrate()` (widely supported on Android Chrome, with
 * growing support on iOS Safari). On unsupported platforms every call is a
 * silent no-op.
 *
 * Behaviour:
 * - `isSupported` and `isEnabled` are `false` on the server and the hydration
 *   render, then resolve, to avoid hydration mismatches.
 * - `isEnabled` is forced to `false` when the user has
 *   `prefers-reduced-motion: reduce` set (and updates live if the user
 *   toggles the OS setting mid-session).
 * - User opt-out is persisted to localStorage under `jaisus-haptics-enabled`;
 *   the default is enabled.
 * - `vibrate(...)` no-ops when `!isSupported || !isEnabled` and swallows
 *   any exception thrown by the underlying API.
 */
export function useHaptics(): UseHapticsResult {
  // All `false` on the server and the hydration render (server snapshots),
  // then the real values — no SSR mismatch.
  // Feature detect: only true if the API is actually a callable function.
  const isSupported = useSyncExternalStore(noopSubscribe, getVibrateSupported, getServerFalse);
  // Respect prefers-reduced-motion, including live changes.
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getServerFalse
  );
  const storedEnabled = useSyncExternalStore(subscribeStoredEnabled, getStoredEnabled, getServerFalse);
  // Set by setEnabled, so this session follows the choice even when it can't
  // be persisted.
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const userEnabled = enabledOverride ?? storedEnabled;

  const isEnabled = userEnabled && !prefersReducedMotion;

  const setEnabled = useCallback((enabled: boolean) => {
    setEnabledOverride(enabled);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // localStorage write may fail (private mode, quota). The in-memory
      // state still updates so the current session reflects the user's
      // choice — we just can't persist it.
    }
  }, []);

  const vibrate = useCallback(
    (pattern: HapticPattern | number | number[]) => {
      if (!isSupported || !isEnabled) return;
      if (typeof window === 'undefined') return;
      try {
        window.navigator.vibrate(resolvePattern(pattern));
      } catch {
        // Some browsers throw when called without user activation or when
        // the API is otherwise disallowed — swallow silently.
      }
    },
    [isSupported, isEnabled]
  );

  return { vibrate, isSupported, isEnabled, setEnabled };
}
