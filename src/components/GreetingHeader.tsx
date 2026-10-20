'use client';

import type { JSX } from 'react';
import { useMemo, useSyncExternalStore } from 'react';
import { bucketForHour, getGreeting, TIME_EMOJI } from '@/lib/greeting';

interface GreetingHeaderProps {
  className?: string;
}

function subscribeToClock(onChange: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'visible') onChange();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const id = setInterval(onChange, 60_000);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(id);
  };
}

/** Changes only when the greeting can change: a new day or time-of-day bucket. */
function getClockSlot(): string {
  const now = new Date();
  return `${now.toDateString()}|${bucketForHour(now.getHours())}`;
}

function getServerClockSlot(): null {
  return null;
}

/**
 * Warm, time-aware greeting for the empty state of the chat.
 *
 * Renders nothing on the server and during hydration — the underlying
 * `getGreeting` uses local time, so SSR (UTC) and CSR (local) can disagree.
 *
 * The greeting follows the clock while the app stays open (re-read on return
 * to the foreground and once a minute).
 */
export function GreetingHeader({
  className,
}: GreetingHeaderProps): JSX.Element | null {
  const slot = useSyncExternalStore(subscribeToClock, getClockSlot, getServerClockSlot);
  const greeting = useMemo(() => (slot ? getGreeting() : null), [slot]);

  if (!greeting) return null;

  const emoji = TIME_EMOJI[greeting.timeOfDay];

  return (
    <div
      className={`text-center py-4 ${className ?? ''}`}
      data-time-of-day={greeting.timeOfDay}
    >
      <div className="text-2xl leading-none mb-2" aria-hidden="true">
        {emoji}
      </div>
      <p className="text-xl font-serif text-stone-800">{greeting.headline}</p>
      <p className="text-sm text-stone-500 mt-1">{greeting.subline}</p>
    </div>
  );
}
