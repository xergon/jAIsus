'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MOODS,
  getMoodContent,
  type MoodContent,
  type MoodInfo,
} from '@/lib/mood-content';

interface MoodSelectorProps {
  /**
   * Called when the user picks a mood. The parent owns what to do next —
   * render the bundle, route to chat, fire analytics, etc. This component
   * holds no "picked" state itself.
   */
  onPick: (mood: MoodInfo, content: MoodContent) => void;
  className?: string;
}

/**
 * Compact 10-tile mood picker for the "I need something specific" path.
 *
 * Sits alongside the daily content — does not replace it. The tile that
 * was just tapped flashes amber for ~300ms purely as visual feedback;
 * after that, all tiles return to neutral so the user can pick again.
 *
 * Selection state intentionally lives in the parent: this keeps the
 * component reusable in flows where picking immediately routes away
 * (e.g. straight into the chat input).
 */
export function MoodSelector({
  onPick,
  className = '',
}: MoodSelectorProps): React.JSX.Element {
  // Local-only — purely for the flash animation. Not the source of truth
  // for what's "selected" (that lives wherever the parent stores it).
  const [flashId, setFlashId] = useState<MoodInfo['id'] | null>(null);
  // Track the flash timeout so unmount cancels it — otherwise React warns
  // "state update on unmounted component" if the user picks a mood and then
  // the empty state disappears (messages arrive) before the 300ms elapses.
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current !== null) {
        clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = null;
      }
    };
  }, []);

  const handlePick = useCallback(
    (mood: MoodInfo) => {
      const content = getMoodContent(mood.id);
      setFlashId(mood.id);
      // Clear any in-flight flash timer so a rapid second pick resets cleanly.
      if (flashTimeoutRef.current !== null) {
        clearTimeout(flashTimeoutRef.current);
      }
      flashTimeoutRef.current = setTimeout(() => {
        setFlashId((current) => (current === mood.id ? null : current));
        flashTimeoutRef.current = null;
      }, 300);
      onPick(mood, content);
    },
    [onPick]
  );

  return (
    <div
      className={['pb-2', className].filter(Boolean).join(' ')}
      aria-label="Mood selector"
    >
      <p className="px-4 mb-2 text-sm font-medium text-stone-700">
        How are you feeling?
      </p>
      {/* 5 cols on >=sm so all ten fit in two rows; 2 cols on mobile so
          labels stay readable without truncating. */}
      <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-5">
        {MOODS.map((mood) => {
          const flashing = flashId === mood.id;
          return (
            <button
              key={mood.id}
              type="button"
              onClick={() => handlePick(mood)}
              aria-label={`Feeling ${mood.label}`}
              className={[
                'flex flex-col items-center justify-center gap-1',
                'rounded-2xl border py-3 px-2',
                'text-xs text-stone-700',
                'shadow-sm',
                'transition-colors duration-200 ease-out',
                'active:scale-95',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60',
                flashing
                  ? 'bg-amber-100 border-amber-300'
                  : 'bg-white border-stone-200 hover:bg-stone-50',
              ].join(' ')}
            >
              <span
                aria-hidden="true"
                className="text-2xl leading-none"
              >
                {mood.emoji}
              </span>
              <span className="text-[11px] sm:text-xs">{mood.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
