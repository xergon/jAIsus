'use client';

import type { JSX } from 'react';
import { useMemo, useSyncExternalStore } from 'react';
import { bucketForHour, getGreeting, TIME_EMOJI } from '@/lib/greeting';
import { useUserProfile } from '@/hooks/useUserProfile';

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

/** "Good morning" → "Good morning, Anna"; "Late night?" → "Late night, Anna?";
 *  "Hi there" / "Hi friend" → "Hi Anna". */
function withName(headline: string, name: string): string {
  if (/^Hi (there|friend)$/.test(headline)) return `Hi ${name}`;
  if (headline.endsWith('?')) return `${headline.slice(0, -1)}, ${name}?`;
  return `${headline}, ${name}`;
}

/**
 * Warm, time-aware greeting for the empty state of the chat.
 *
 * Renders nothing on the server and during hydration — the underlying
 * `getGreeting` uses local time, so SSR (UTC) and CSR (local) can disagree.
 *
 * The greeting follows the clock while the app stays open (re-read on return
 * to the foreground and once a minute). With a remembered name it greets
 * the user by it (the name comes from localStorage, so it too is only known
 * after hydration).
 */
export function GreetingHeader({
  className,
}: GreetingHeaderProps): JSX.Element | null {
  const slot = useSyncExternalStore(subscribeToClock, getClockSlot, getServerClockSlot);
  const greeting = useMemo(() => (slot ? getGreeting() : null), [slot]);
  const { name } = useUserProfile();

  if (!greeting) return null;

  const emoji = TIME_EMOJI[greeting.timeOfDay];
  const headline = name ? withName(greeting.headline, name) : greeting.headline;

  return (
    <div
      className={`text-center py-4 ${className ?? ''}`}
      data-time-of-day={greeting.timeOfDay}
    >
      <div className="text-2xl leading-none mb-2" aria-hidden="true">
        {emoji}
      </div>
      <p className="text-xl font-serif text-stone-800 [overflow-wrap:anywhere]">{headline}</p>
      <p className="text-sm text-stone-500 mt-1">{greeting.subline}</p>
    </div>
  );
}
