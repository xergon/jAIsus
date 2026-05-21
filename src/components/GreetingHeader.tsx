'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { getGreeting, TIME_EMOJI, type Greeting } from '@/lib/greeting';

interface GreetingHeaderProps {
  className?: string;
}

/**
 * Warm, time-aware greeting for the empty state of the chat.
 *
 * Renders nothing until the component has mounted on the client — the
 * underlying `getGreeting` uses local time, so SSR (UTC) and CSR (local)
 * can disagree. Guarding behind `useEffect` avoids a hydration mismatch.
 */
export function GreetingHeader({
  className,
}: GreetingHeaderProps): JSX.Element | null {
  const [greeting, setGreeting] = useState<Greeting | null>(null);

  useEffect(() => {
    setGreeting(getGreeting());
  }, []);

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
