'use client';

import { useEffect, useRef, useState } from 'react';
import { useConversationMemory } from '@/hooks/useConversationMemory';
import { useModalA11y } from '@/hooks/useModalA11y';
import { getPersonality } from '@/lib/personalities';
import { getCustomPersonality, isCustomId } from '@/lib/custom-personalities';
import { EmptyState } from '@/components/EmptyState';

interface MemoriesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Returns a short relative-time string for a timestamp.
 * "today" / "yesterday" / "N days ago" / "N weeks ago" / formatted date.
 */
function relativeTime(timestamp: number, now: number): string {
  const dayMs = 24 * 60 * 60 * 1000;
  // Normalize to local-midnight day boundaries so "yesterday" matches calendar
  // expectations rather than a strict 24h slide.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfCreated = new Date(timestamp);
  startOfCreated.setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfCreated.getTime()) / dayMs
  );

  if (dayDiff <= 0) return 'today';
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff < 7) return `${dayDiff} days ago`;
  if (dayDiff < 14) return '1 week ago';
  if (dayDiff < 28) return `${Math.floor(dayDiff / 7)} weeks ago`;
  // Fall back to "Apr 25" style. Include year only if it's not the current year.
  const created = new Date(timestamp);
  const sameYear = created.getFullYear() === new Date(now).getFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return created.toLocaleDateString(undefined, opts);
}

export function MemoriesPanel({ isOpen, onClose }: MemoriesPanelProps) {
  const { memories, removeMemory, clearMemories } = useConversationMemory();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });

  const [confirmingClear, setConfirmingClear] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pin "now" so relative times don't churn on every render. Refreshed on the
  // first frame after the panel opens (good enough — drawer is short-lived).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // When closing, reset transient UI so re-opening is clean. Adjusted during
  // render (React's "store info from previous renders" pattern); the timer
  // is cleared in the effect below.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (!isOpen) setConfirmingClear(false);
  }
  useEffect(() => {
    if (isOpen) return;
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, [isOpen]);

  // Cleanup pending timer on unmount.
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const handleClearClick = () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmingClear(false);
        confirmTimerRef.current = null;
      }, 3000);
      return;
    }
    // Confirmed
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    clearMemories();
    setConfirmingClear(false);
  };

  return (
    <div
      className={`fixed inset-0 z-50 transition-all duration-300 ${
        isOpen ? 'visible' : 'invisible'
      }`}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="memories-title"
        className={`absolute bottom-0 left-0 right-0 max-h-[80vh] bg-white rounded-t-2xl shadow-2xl
          transition-transform duration-300 ease-out ${
            isOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div
            className="w-10 h-1 rounded-full bg-stone-300"
            aria-hidden="true"
          />
        </div>

        <div className="px-4 pb-1 flex items-center justify-between gap-3">
          <h2
            id="memories-title"
            className="text-lg font-bold text-stone-800"
          >
            Memories ({memories.length})
          </h2>
          {/* Close comes first in DOM order: it gets focus on open (not the
              destructive Clear all), and touch screen-reader users, who
              can't reach the aria-hidden backdrop or press Escape, get a way
              out — with no memories it is the only control in the sheet. */}
          <div className="flex flex-row-reverse items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close memories"
              className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 active:scale-95 transition-transform"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
            {memories.length > 0 && (
              <button
                type="button"
                onClick={handleClearClick}
                aria-label={
                  confirmingClear
                    ? 'Confirm clear all memories'
                    : 'Clear all memories'
                }
                className={`text-xs ${
                  confirmingClear
                    ? 'text-rose-700 font-semibold'
                    : 'text-rose-600 hover:underline'
                } active:scale-[0.98] transition-transform`}
              >
                {confirmingClear ? 'Sure? Tap again to confirm' : 'Clear all'}
              </button>
            )}
          </div>
        </div>

        <p className="px-4 text-xs text-stone-500 mt-1 pb-2">
          Short summaries of what we&apos;ve talked about. jAIsus references these
          to keep continuity. Stored only on this device.
        </p>

        <div className="overflow-y-auto px-4 pb-6 max-h-[65vh] modal-scroll">
          {memories.length === 0 ? (
            <EmptyState
              icon="✨"
              title="No memories yet"
              description="When you clear a conversation, jAIsus saves a one-line summary here so future sessions feel like a continuation."
            />
          ) : (
            <ul className="pt-2" role="list">
              {memories.map(mem => {
                // getPersonality() falls back to Mushroom Guru for unknown ids,
                // which mislabels memories from a since-deleted custom personality.
                const personality =
                  isCustomId(mem.personalityId) && !getCustomPersonality(mem.personalityId)
                    ? { emoji: '✨', name: 'Custom (deleted)' }
                    : getPersonality(mem.personalityId);
                return (
                  <li
                    key={mem.id}
                    className="bg-stone-50 rounded-xl border border-stone-200 p-3 mb-2"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Top row: personality chip + relative date */}
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-stone-200 text-stone-700 px-2 py-0.5 text-xs font-medium">
                            <span aria-hidden="true">{personality.emoji}</span>
                            <span>{personality.name}</span>
                          </span>
                          <span
                            className="text-xs text-stone-400 shrink-0"
                            title={new Date(mem.timestamp).toLocaleString()}
                          >
                            {relativeTime(mem.timestamp, now)}
                          </span>
                        </div>

                        {/* Body */}
                        <p className="text-sm text-stone-700 leading-relaxed">
                          {mem.summary}
                        </p>

                        {/* Message count badge */}
                        {mem.messageCount > 0 && (
                          <div className="flex justify-end mt-1.5">
                            <span className="text-[10px] text-stone-400">
                              {mem.messageCount} msgs
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Right-side remove button */}
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => removeMemory(mem.id)}
                          aria-label="Remove this memory"
                          className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-rose-600 hover:bg-rose-50 active:scale-[0.95] transition-all"
                        >
                          <span aria-hidden="true">❌</span>
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
