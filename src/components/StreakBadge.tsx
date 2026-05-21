'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
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
      label: `\u{1F525} 30 days — you're devoted`,
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

export function StreakBadge({
  autoRecord = true,
  size = 'sm',
  className,
}: StreakBadgeProps): JSX.Element | null {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<StreakState>({
    current: 0,
    longest: 0,
    lastActive: null,
    totalDays: 0,
  });

  // Initial mount: optionally record today's activity, then read state.
  useEffect(() => {
    if (autoRecord) {
      // recordActivity is idempotent within a calendar day, so calling
      // unconditionally on every mount is safe.
      const next = recordActivity();
      setState(next);
    } else {
      setState(getStreakState());
    }
    setMounted(true);
  }, [autoRecord]);

  // Subscribe to cross-component changes (e.g. clearStreak in Settings).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setState(getStreakState());
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  // SSR + first client paint: render nothing to avoid hydration mismatch
  // (state depends on localStorage + local-time date math).
  if (!mounted) return null;

  // Nothing to show before the user has used the app at all.
  if (state.current === 0) return null;

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
