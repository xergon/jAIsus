'use client';

import type { JSX } from 'react';

interface PullToRefreshIndicatorProps {
  /** 0..1 — drives rotation/opacity of the arrow */
  progress: number;
  /** Px the user has pulled — drives translateY of the indicator */
  pullDistance: number;
  /** When true, swap the arrow for a spinner */
  isRefreshing: boolean;
}

/**
 * Visual indicator for {@link usePullToRefresh}.
 *
 * Lives just below the top edge of the scroll container — the parent places it
 * at the top of the scrollable subtree, and the component drives its own
 * `translateY` from `pullDistance` to follow the finger.
 *
 * - Not refreshing: a downward arrow that rotates 0deg → 180deg as `progress`
 *   goes 0 → 1, so at the trigger threshold it points up ("release to refresh").
 * - Refreshing: a small spinning teal ring (uses `animate-spin`).
 *
 * Opacity fades in linearly with progress (full at ~67% of threshold) so the
 * indicator is visible well before the user reaches the release point.
 *
 * @example
 *   <div className="overflow-y-auto" {...bind}>
 *     <PullToRefreshIndicator
 *       progress={progress}
 *       pullDistance={pullDistance}
 *       isRefreshing={isRefreshing}
 *     />
 *     {content}
 *   </div>
 */
export function PullToRefreshIndicator({
  progress,
  pullDistance,
  isRefreshing,
}: PullToRefreshIndicatorProps): JSX.Element {
  // While refreshing, hold the indicator in a stable position so the spinner
  // doesn't bob — the hook snaps `pullDistance` to threshold during refresh,
  // but we still rely on the hook-supplied value for translateY.
  const opacity = isRefreshing ? 1 : Math.min(1, progress * 1.5);
  const arrowRotation = Math.min(1, progress) * 180;

  return (
    <div
      // Positioned absolutely so it sits at the top of the scroll container
      // without consuming layout space. The parent must be `relative`.
      className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2"
      style={{
        // translateY moves it down from the top edge as the user pulls. We
        // combine the centering translateX with the dynamic translateY here.
        // (Tailwind's -translate-x-1/2 above handles the centering; we add Y
        // via inline style which composes alongside the class transform.)
        opacity,
        transform: `translateX(-50%) translateY(${pullDistance}px)`,
        willChange: 'transform, opacity',
      }}
      aria-live="polite"
      aria-hidden={pullDistance === 0 && !isRefreshing ? true : undefined}
    >
      <div className="w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center">
        {isRefreshing ? (
          // Spinner — teal ring with a transparent top to create the
          // spinning effect via Tailwind's `animate-spin`.
          <div
            className="w-4 h-4 rounded-full border-2 border-teal-400 border-t-transparent animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          // Downward arrow — rotates to upward as progress reaches 1.
          // Drawn with an inline SVG so we don't depend on an icon library.
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            style={{
              transform: `rotate(${arrowRotation}deg)`,
              transition: 'transform 120ms ease-out',
            }}
          >
            <path
              d="M8 2.5v9m0 0L4 7.5m4 4l4-4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-teal-500"
            />
          </svg>
        )}
      </div>
      <span className="sr-only">
        {isRefreshing ? 'Refreshing' : 'Pull to refresh'}
      </span>
    </div>
  );
}
