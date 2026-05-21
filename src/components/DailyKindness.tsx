'use client';

import {
  ALL_KINDNESS_ACTS,
  getDailyKindness,
} from '@/lib/daily-kindness';

interface DailyKindnessProps {
  className?: string;
}

export function DailyKindness({ className = '' }: DailyKindnessProps) {
  // Render nothing if the catalog is empty.
  if (ALL_KINDNESS_ACTS.length === 0) return null;

  const act = getDailyKindness();

  // Defensive: if the act somehow has no text, render nothing.
  if (!act.text || act.text.trim().length === 0) return null;

  return (
    <div
      className={`bg-teal-50 border border-teal-200 rounded-2xl shadow-sm px-4 py-3 ${className}`}
      aria-label="Act of kindness for today"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-full bg-white border border-teal-200 flex items-center justify-center text-base leading-none"
          aria-hidden="true"
        >
          <span role="img" aria-hidden="true">🌱</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">
              Act of kindness
            </span>
          </div>
          <p className="text-sm text-stone-700 leading-relaxed">
            {act.text}
          </p>
          <div className="flex justify-end mt-1.5">
            <span className="text-[10px] uppercase tracking-wide text-stone-500">
              {act.category}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
