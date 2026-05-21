'use client';

import {
  getDailySuggestions,
  type SuggestedPrompt,
} from '@/lib/suggested-prompts';

interface SuggestedPromptsProps {
  /** Called when user taps a prompt — pass the text to your sendMessage handler */
  onPick: (text: string) => void;
  /** Optional override; default is 5 daily prompts */
  prompts?: SuggestedPrompt[];
  className?: string;
}

export function SuggestedPrompts({
  onPick,
  prompts,
  className = '',
}: SuggestedPromptsProps) {
  const items = prompts ?? getDailySuggestions();
  if (!items || items.length === 0) return null;

  return (
    <div
      className={['pb-2', className].filter(Boolean).join(' ')}
      aria-label="Suggested prompts"
    >
      <p className="px-4 mb-2 text-xs uppercase tracking-wide text-stone-400">
        Try asking...
      </p>
      <div
        className="
          flex gap-2 px-4
          overflow-x-auto scroll-smooth snap-x snap-mandatory
          [-ms-overflow-style:none] [scrollbar-width:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        {items.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.text)}
            className="
              snap-start shrink-0
              inline-flex items-center gap-1.5
              rounded-full bg-white border border-stone-200
              px-4 py-2.5 text-sm text-stone-700
              max-w-[18rem] truncate
              shadow-sm
              transition-transform duration-150 ease-out
              hover:bg-stone-50
              active:scale-95
              focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60
            "
          >
            {p.icon && (
              <span aria-hidden="true" className="text-base leading-none">
                {p.icon}
              </span>
            )}
            <span className="truncate">{p.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
