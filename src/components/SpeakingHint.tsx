'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { VoiceState } from '@/lib/types';

interface SpeakingHintProps {
  voiceState: VoiceState;
  /** When set, the hint auto-hides after this many ms once shown. Default 4000. Set 0 to disable auto-hide. */
  autoHideMs?: number;
  /** Optional callback when user taps the hint (e.g., to actually stop speech) */
  onInterrupt?: () => void;
  className?: string;
}

/**
 * Maximum number of times the hint can appear in a single page-load session.
 * After this many showings the user has demonstrably learned that they can
 * interrupt by tapping — we stop showing the hint until they reload.
 */
const MAX_SHOWS_PER_SESSION = 3;

/** Duration (ms) of the fade/scale enter/exit transition. */
const ANIMATION_MS = 200;

/**
 * Read `prefers-reduced-motion: reduce` once, safely on the client. Used as
 * a lazy initial state value so the subscribing effect doesn't have to call
 * setState during mount (which the react-hooks/set-state-in-effect lint rule
 * flags).
 */
function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Discreet "Tap to interrupt" pill that surfaces near the bottom of the
 * screen while jAIsus is speaking. Its job is purely discoverability — the
 * actual interrupt is already wired (the mic button stops speech when busy).
 *
 * Behaviour:
 *   - Only renders while `voiceState === 'speaking'`.
 *   - Fades in on the rising edge of the speaking state, then auto-hides after
 *     `autoHideMs` (default 4000ms). Even if voice stays 'speaking', the pill
 *     disappears once shown long enough — the user has seen it.
 *   - Tracks the rising edge with a ref so the hint can recur on a fresh
 *     speech session, but only up to MAX_SHOWS_PER_SESSION (3) total per
 *     page load. After that the user has learned; stop nagging.
 *   - Tapping fires `onInterrupt?.()` and hides immediately.
 *   - Respects `prefers-reduced-motion: reduce` — skips transitions, just
 *     instant show/hide.
 *   - All timers are cleaned up on unmount and on every voiceState change.
 */
export function SpeakingHint({
  voiceState,
  autoHideMs = 4000,
  onInterrupt,
  className,
}: SpeakingHintProps): JSX.Element | null {
  // Whether the hint should currently be visible. Independent from voiceState
  // because we hide it after the auto-hide timeout even while still speaking.
  const [visible, setVisible] = useState(false);
  // Controls the enter/exit transition. `false` = initial (scale-90, opacity-0),
  // `true` = entered (scale-100, opacity-100). Flipped to `false` again on exit.
  const [entered, setEntered] = useState(false);

  // Has the hint already been shown for the current rising edge of 'speaking'?
  // Reset when voiceState transitions OUT of 'speaking'.
  const shownThisEventRef = useRef(false);
  // How many times has the hint been shown in this page-load session? Capped
  // at MAX_SHOWS_PER_SESSION.
  const sessionShowCountRef = useRef(0);
  // Pending auto-hide timeout handle. Cleared on unmount / state change.
  const autoHideTimerRef = useRef<number | null>(null);
  // Pending exit-transition timeout handle (so we can unmount cleanly after
  // the fade-out finishes).
  const exitTimerRef = useRef<number | null>(null);

  const [reducedMotion, setReducedMotion] = useState<boolean>(readReducedMotion);

  // Subscribe to OS-level reduced-motion changes so toggling the setting
  // mid-session is honoured.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);

  // Helper to clear any pending timers in one place.
  const clearTimers = useCallback(() => {
    if (autoHideTimerRef.current !== null) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  // Begin the exit transition, then unmount the pill after the animation
  // completes. With reduced motion we just snap to hidden.
  const beginHide = useCallback(() => {
    if (reducedMotion) {
      setEntered(false);
      setVisible(false);
      return;
    }
    setEntered(false);
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
    }
    exitTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      exitTimerRef.current = null;
    }, ANIMATION_MS);
  }, [reducedMotion]);

  // Drive the show/hide logic off voiceState transitions.
  useEffect(() => {
    if (voiceState === 'speaking') {
      // Only show on the rising edge of a fresh speech session, and only if
      // we haven't already hit the per-session cap.
      if (
        !shownThisEventRef.current &&
        sessionShowCountRef.current < MAX_SHOWS_PER_SESSION
      ) {
        shownThisEventRef.current = true;
        sessionShowCountRef.current += 1;

        // Mount + start enter transition.
        setVisible(true);
        if (reducedMotion) {
          setEntered(true);
        } else {
          // Flip on the next frame so the CSS transition has an initial
          // (scale-90, opacity-0) state to interpolate from.
          const raf = requestAnimationFrame(() => setEntered(true));
          // We don't need to cancel this RAF on the cleanup path — by the
          // time cleanup runs the frame has either fired or been dropped.
          // Stashing it would just add noise.
          void raf;
        }

        // Schedule auto-hide. autoHideMs === 0 disables it entirely (the pill
        // stays until voiceState changes).
        if (autoHideMs > 0) {
          if (autoHideTimerRef.current !== null) {
            clearTimeout(autoHideTimerRef.current);
          }
          autoHideTimerRef.current = window.setTimeout(() => {
            autoHideTimerRef.current = null;
            beginHide();
          }, autoHideMs);
        }
      }
    } else {
      // Leaving 'speaking' — reset the rising-edge gate so the next speech
      // session can show the hint again (subject to the session cap).
      shownThisEventRef.current = false;
      // Cancel any scheduled auto-hide; we're tearing down anyway.
      if (autoHideTimerRef.current !== null) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
      // Hide the pill if it was showing.
      if (visible) {
        beginHide();
      }
    }

    // Important: don't clear timers in the cleanup of this effect on every
    // render — beginHide schedules an exitTimer we want to survive. The
    // unmount-only cleanup below handles that case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, autoHideMs, reducedMotion]);

  // Final cleanup on unmount.
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  // User-initiated dismissal — fire callback and hide immediately.
  const handleTap = useCallback(() => {
    if (autoHideTimerRef.current !== null) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
    if (onInterrupt) {
      try {
        onInterrupt();
      } catch (err) {
        // Don't let a misbehaving handler block dismissal.
        console.error('[SpeakingHint] onInterrupt handler threw:', err);
      }
    }
    beginHide();
  }, [onInterrupt, beginHide]);

  if (!visible) return null;

  const transitionClasses = reducedMotion
    ? ''
    : 'transition-all duration-200 ease-out';

  const stateClasses = reducedMotion
    ? ''
    : entered
      ? 'opacity-100 scale-100'
      : 'opacity-0 scale-90';

  const classes = [
    // Positioning — fixed, just above the input bar, centered.
    'fixed bottom-24 left-1/2 -translate-x-1/2 z-30',
    // Pill styling.
    'bg-stone-900/80 backdrop-blur-sm text-white',
    'rounded-full px-4 py-2 shadow-lg',
    'text-xs font-medium',
    'flex items-center gap-2',
    // Invite the tap.
    'hover:scale-105 hover:shadow-xl active:scale-100',
    // Focus ring for keyboard users.
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
    transitionClasses,
    stateClasses,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      onClick={handleTap}
      role="status"
      aria-live="polite"
      aria-label="jAIsus is speaking — tap to interrupt"
      className={classes}
    >
      {/* Mic-with-strikethrough icon. ~14px. */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="4" y1="4" x2="20" y2="20" />
      </svg>
      <span>Tap to interrupt</span>
    </button>
  );
}
