'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface UsePullToRefreshOptions {
  /** Called when user pulls past threshold and releases. Return a Promise; the spinner stays until it resolves. */
  onRefresh: () => Promise<void>;
  /** Pixels of drag to trigger refresh (default 80) */
  threshold?: number;
  /** Max drag distance — clamps the indicator position (default 120) */
  maxPull?: number;
  /** Disable the gesture (e.g., while a modal is open) */
  disabled?: boolean;
}

export interface UsePullToRefreshResult {
  /** Attach to the scroll container's onTouchStart/Move/End */
  bind: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
  /** 0..1 progress of the current pull, for animating the indicator */
  progress: number;
  /** True while onRefresh is pending */
  isRefreshing: boolean;
  /** Px the user has currently pulled */
  pullDistance: number;
}

const DEFAULT_THRESHOLD = 80;
const DEFAULT_MAX_PULL = 120;
/** If horizontal travel exceeds vertical by this px, abort — user is swiping sideways. */
const HORIZONTAL_ABORT_PX = 8;
/** Resistance factor — feels like dragging through molasses. */
const RESISTANCE_FACTOR = 0.5;
/** Animate-back-to-zero duration. */
const SETTLE_DURATION_MS = 220;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const noopBind: UsePullToRefreshResult['bind'] = {
  onTouchStart: () => {},
  onTouchMove: () => {},
  onTouchEnd: () => {},
};

/**
 * Get the scrollTop of the nearest scrolling ancestor of `el` — or `el` itself
 * if it scrolls. The pull gesture should only engage when the actual scroll
 * container is at the top.
 */
function getScrollTopFor(el: EventTarget | null): number {
  if (!(el instanceof Element)) {
    return typeof window === 'undefined' ? 0 : (window.scrollY || 0);
  }
  let node: Element | null = el;
  while (node && node instanceof Element) {
    const style =
      typeof window !== 'undefined' ? window.getComputedStyle(node) : null;
    const overflowY = style?.overflowY ?? '';
    const scrolls =
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      node.scrollHeight > node.clientHeight;
    if (scrolls) return node.scrollTop;
    node = node.parentElement;
  }
  // Nothing scrolls — fall back to the page scroll.
  return typeof window === 'undefined' ? 0 : (window.scrollY || 0);
}

/**
 * Pull-to-refresh gesture hook for a scroll container.
 *
 * Behaviour:
 * - Engages only when the scroll container is at `scrollTop === 0` on touchstart.
 *   Otherwise the user is mid-scroll and we don't hijack.
 * - Vertical-only: aborts if horizontal travel beats vertical by more than a
 *   small threshold (treat as a sideways swipe).
 * - Applies square-root-like resistance so the indicator feels rubbery rather
 *   than 1:1 with the finger.
 * - Clamps the pull to `maxPull`.
 * - On release past `threshold`: runs `onRefresh()` and holds the spinner
 *   visible until the returned Promise settles, then animates back to 0.
 * - On release under threshold: animates back to 0 (no refresh).
 * - Respects `prefers-reduced-motion`: snaps back instead of animating.
 * - When `disabled`, the binds are no-ops and no state ever advances.
 *
 * The gesture state during an active drag lives in refs (not React state) to
 * avoid re-rendering on every touchmove. React state is updated via rAF so the
 * indicator can re-render at most once per frame.
 *
 * @example
 *   const { bind, progress, pullDistance, isRefreshing } = usePullToRefresh({
 *     onRefresh: async () => { await refetchDaily(); },
 *   });
 *   return (
 *     <div className="overflow-y-auto" {...bind}>
 *       <PullToRefreshIndicator
 *         progress={progress}
 *         pullDistance={pullDistance}
 *         isRefreshing={isRefreshing}
 *       />
 *       {content}
 *     </div>
 *   );
 */
export function usePullToRefresh(
  options: UsePullToRefreshOptions
): UsePullToRefreshResult {
  const {
    onRefresh,
    threshold = DEFAULT_THRESHOLD,
    maxPull = DEFAULT_MAX_PULL,
    disabled = false,
  } = options;

  // Keep latest onRefresh in a ref so the handlers don't need to re-bind every
  // render. The caller usually passes an inline arrow function.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // Gesture state — lives in refs to avoid re-rendering on every touchmove.
  const startYRef = useRef<number | null>(null);
  const startXRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const abortedRef = useRef(false);
  const pullRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const settleRafRef = useRef<number | null>(null);

  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const cancelScheduledFrame = useCallback(() => {
    if (rafIdRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = null;
  }, []);

  const cancelSettle = useCallback(() => {
    if (
      settleRafRef.current !== null &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(settleRafRef.current);
    }
    settleRafRef.current = null;
  }, []);

  const prefersReducedMotion = useCallback((): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    try {
      return window.matchMedia(REDUCED_MOTION_QUERY).matches;
    } catch {
      return false;
    }
  }, []);

  /** Animate `pullDistance` from its current value down to 0. */
  const settleToZero = useCallback(() => {
    cancelSettle();
    const start = pullRef.current;
    if (start === 0) {
      setPullDistance(0);
      return;
    }
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      pullRef.current = 0;
      setPullDistance(0);
      return;
    }
    const startTime =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / SETTLE_DURATION_MS);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = start * (1 - eased);
      pullRef.current = next;
      setPullDistance(next);
      if (t < 1) {
        settleRafRef.current = requestAnimationFrame(tick);
      } else {
        pullRef.current = 0;
        setPullDistance(0);
        settleRafRef.current = null;
      }
    };
    settleRafRef.current = requestAnimationFrame(tick);
  }, [cancelSettle, prefersReducedMotion]);

  /** Reset all gesture refs to a fresh, non-active state. */
  const resetGesture = useCallback(() => {
    startYRef.current = null;
    startXRef.current = null;
    activeRef.current = false;
    abortedRef.current = false;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled || isRefreshing) return;
      const touch = e.touches[0];
      if (!touch) return;

      // Only engage if the scroll container is at the top.
      const scrollTop = getScrollTopFor(e.currentTarget);
      if (scrollTop > 0) {
        // Not at top — user is scrolling; don't engage.
        resetGesture();
        return;
      }

      startYRef.current = touch.clientY;
      startXRef.current = touch.clientX;
      activeRef.current = true;
      abortedRef.current = false;
      pullRef.current = 0;
      // Cancel any in-flight settle from a previous gesture.
      cancelSettle();
    },
    [disabled, isRefreshing, resetGesture, cancelSettle]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (disabled || isRefreshing) return;
      if (!activeRef.current || abortedRef.current) return;
      const touch = e.touches[0];
      if (!touch || startYRef.current === null || startXRef.current === null) {
        return;
      }

      const dy = touch.clientY - startYRef.current;
      const dx = touch.clientX - startXRef.current;

      // Upward drag — user is scrolling, not pulling. Abort.
      if (dy <= 0) {
        if (pullRef.current !== 0) {
          pullRef.current = 0;
          // Schedule a frame to reflect the reset.
          if (rafIdRef.current === null && typeof requestAnimationFrame === 'function') {
            rafIdRef.current = requestAnimationFrame(() => {
              rafIdRef.current = null;
              setPullDistance(0);
            });
          } else if (typeof requestAnimationFrame !== 'function') {
            setPullDistance(0);
          }
        }
        return;
      }

      // Horizontal swipe dominates — abort.
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > HORIZONTAL_ABORT_PX) {
        abortedRef.current = true;
        if (pullRef.current !== 0) {
          pullRef.current = 0;
          setPullDistance(0);
        }
        return;
      }

      // Apply resistance and clamp.
      const resisted = dy * RESISTANCE_FACTOR;
      const next = Math.max(0, Math.min(maxPull, resisted));
      pullRef.current = next;

      // Throttle React state updates to one per animation frame.
      if (rafIdRef.current === null && typeof requestAnimationFrame === 'function') {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          setPullDistance(pullRef.current);
        });
      } else if (typeof requestAnimationFrame !== 'function') {
        setPullDistance(next);
      }
    },
    [disabled, isRefreshing, maxPull]
  );

  const onTouchEnd = useCallback(() => {
    if (disabled || isRefreshing) {
      resetGesture();
      return;
    }
    if (!activeRef.current) return;
    const wasAborted = abortedRef.current;
    const finalPull = pullRef.current;
    resetGesture();
    // Cancel any pending touchmove rAF — we're about to drive pull explicitly.
    cancelScheduledFrame();

    if (!wasAborted && finalPull >= threshold) {
      // Trigger refresh. Snap to the threshold so the spinner sits in place
      // while the async work happens.
      pullRef.current = threshold;
      setPullDistance(threshold);
      setIsRefreshing(true);

      // Defensive: even if onRefresh throws synchronously, settle cleanly.
      let promise: Promise<void>;
      try {
        promise = Promise.resolve(onRefreshRef.current());
      } catch (err) {
        promise = Promise.reject(err);
      }
      promise
        .catch(() => {
          // Caller-defined onRefresh failed — we don't surface the error; the
          // caller is responsible for its own error handling. We just make
          // sure the indicator returns to rest.
        })
        .finally(() => {
          setIsRefreshing(false);
          settleToZero();
        });
    } else {
      // Under threshold or aborted — animate back to 0 with no refresh.
      settleToZero();
    }
  }, [
    disabled,
    isRefreshing,
    threshold,
    resetGesture,
    cancelScheduledFrame,
    settleToZero,
  ]);

  // Cleanup any pending rAF on unmount.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (
        settleRafRef.current !== null &&
        typeof cancelAnimationFrame === 'function'
      ) {
        cancelAnimationFrame(settleRafRef.current);
        settleRafRef.current = null;
      }
    };
  }, []);

  // If `disabled` flips to true mid-gesture, drop any in-progress drag and
  // hide the indicator.
  useEffect(() => {
    if (!disabled) return;
    resetGesture();
    cancelScheduledFrame();
    cancelSettle();
    pullRef.current = 0;
    setPullDistance(0);
  }, [disabled, resetGesture, cancelScheduledFrame, cancelSettle]);

  const progress = Math.min(1, pullDistance / Math.max(1, threshold));

  // When disabled, return no-op binds and constant zero state.
  if (disabled) {
    return {
      bind: noopBind,
      progress: 0,
      isRefreshing: false,
      pullDistance: 0,
    };
  }

  return {
    bind: { onTouchStart, onTouchMove, onTouchEnd },
    progress,
    isRefreshing,
    pullDistance,
  };
}
