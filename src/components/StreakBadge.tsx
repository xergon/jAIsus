'use client';

import type { JSX } from 'react';
import { useEffect, useSyncExternalStore } from 'react';
import {
  getStreakState,
  recordActivity,
  type StreakState,
} from '@/lib/streaks';

interface StreakBadgeProps {
  /** When true (default), automatically records activity once on mount. */
  autoRecord?: boolean;
  /** Visual size */
  size?: 'sm' | 'md';
  className?: string;
}

const CHANGE_EVENT = 'jaisus-streak-changed';

/**
 * Returns the visual style + label text appropriate for the given streak.
 * Separated so the rendering logic stays declarative.
 */
function tierFor(current: number): {
  label: string;
  // Tailwind classes for the chip background/border/text.
  chip: string;
} {
  if (current >= 30) {
    return {
      label: `\u{1F525} ${current} days — you're devoted`,
      chip:
        'bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 text-white border-transparent shadow-sm',
    };
  }
  if (current >= 7) {
    return {
      label: `\u{1F525} ${current} day streak — incredible`,
      chip: 'bg-amber-100 text-amber-900 border-amber-300',
    };
  }
  if (current >= 2) {
    return {
      label: `\u{1F525} ${current} day streak`,
      chip: 'bg-amber-50 text-amber-800 border-amber-200',
    };
  }
  // current === 1
  return {
    label: `\u{1F525} Day 1`,
    chip: 'bg-amber-50 text-amber-800 border-amber-200',
  };
}

function subscribeToStreak(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

// useSyncExternalStore needs the same object back while nothing has changed.
let cachedKey = '';
let cachedState: StreakState | null = null;

function getStreakSnapshot(): StreakState {
  const next = getStreakState();
  const key = `${next.current}|${next.longest}|${next.lastActive}|${next.totalDays}`;
  if (!cachedState || key !== cachedKey) {
    cachedKey = key;
    cachedState = next;
  }
  return cachedState;
}

// SSR + hydration render nothing: the state depends on localStorage and
// local-time date math.
function getServerStreakSnapshot(): StreakState | null {
  return null;
}

export function StreakBadge({
  autoRecord = true,
  size = 'sm',
  className,
}: StreakBadgeProps): JSX.Element | null {
  // Also re-reads after clearStreak in Settings or recordActivity elsewhere,
  // both of which emit CHANGE_EVENT.
  const state = useSyncExternalStore(subscribeToStreak, getStreakSnapshot, getServerStreakSnapshot);

  // recordActivity is idempotent within a calendar day, so calling it on
  // every mount is safe; a real change emits CHANGE_EVENT and re-renders.
  useEffect(() => {
    if (autoRecord) recordActivity();
  }, [autoRecord]);

  // Nothing to show before mount, or before the user has used the app at all.
  if (!state || state.current === 0) return null;

  const { label, chip } = tierFor(state.current);

  const sizeClasses =
    size === 'md' ? 'text-sm px-3 py-1.5' : 'text-xs px-2.5 py-1';

  const longestPart =
    state.longest > state.current
      ? `, longest was ${state.longest} days`
      : '';
  const ariaLabel =
    state.current === 1
      ? `Day 1 of your streak${longestPart}`
      : `${state.current} day streak${longestPart}`;

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={[
        'inline-flex items-center gap-1 rounded-full border font-medium',
        'select-none whitespace-nowrap',
        sizeClasses,
        chip,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {label}
    </span>
  );
}
