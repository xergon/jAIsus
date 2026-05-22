'use client';

import { getDailyVerse, verses } from '@/lib/daily-verse';

interface DailyVerseProps {
  className?: string;
}

export function DailyVerse({ className = '' }: DailyVerseProps) {
  // Render nothing if the verse catalog is empty.
  if (verses.length === 0) return null;

  const verse = getDailyVerse();

  // Defensive: if the verse somehow has no text, render nothing.
  if (!verse.text || verse.text.trim().length === 0) return null;

  return (
    <div
      className={`bg-white border border-stone-200 rounded-2xl shadow-sm px-4 py-3 ${className}`}
      aria-label="Verse of the day"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center text-base leading-none"
          aria-hidden="true"
        >
          <span aria-hidden="true">📖</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              Verse of the day
            </span>
            {verse.theme && (
              <span className="text-[10px] text-teal-700 bg-teal-50 border border-teal-100 rounded-full px-2 py-0.5">
                {verse.theme}
              </span>
            )}
          </div>
          <p className="text-sm italic text-amber-900 leading-relaxed">
            “{verse.text}”
          </p>
          <p className="text-xs text-stone-500 mt-1.5">{verse.reference}</p>
        </div>
      </div>
    </div>
  );
}
