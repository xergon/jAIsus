'use client';

import { useEffect, useRef, useState } from 'react';
import { useFavorites } from '@/hooks/useFavorites';
import { useModalA11y } from '@/hooks/useModalA11y';
import { clearFavorites, removeFavorite, type Favorite } from '@/lib/favorites';
import { EmptyState } from '@/components/EmptyState';
import { toast } from '@/lib/toast';

interface FavoritesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional: tapping a favorite re-sends it to chat (e.g. "ask jAIsus about this verse again") */
  onAskAgain?: (content: string) => void;
}

const TRUNCATE_THRESHOLD = 200;

/** Collapsed preview: cut at a word near the threshold, and never between
 *  the two halves of an emoji (a lone surrogate renders as '�'). */
function truncate(s: string): string {
  const space = s.lastIndexOf(' ', TRUNCATE_THRESHOLD);
  let cut = space > TRUNCATE_THRESHOLD * 0.6 ? space : TRUNCATE_THRESHOLD;
  const c = s.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut -= 1;
  return `${s.slice(0, cut).trimEnd()}…`;
}

const KIND_CHIP_CLASSES: Record<Favorite['kind'], string> = {
  message: 'bg-rose-100 text-rose-700',
  teaching: 'bg-amber-100 text-amber-800',
  verse: 'bg-blue-100 text-blue-800',
  parable: 'bg-teal-100 text-teal-700',
};

const KIND_LABEL: Record<Favorite['kind'], string> = {
  message: 'message',
  teaching: 'teaching',
  verse: 'verse',
  parable: 'parable',
};

/**
 * Returns a short relative-time string for a createdAt timestamp.
 * "today" / "yesterday" / "N days ago" / "N weeks ago" / formatted date.
 */
function relativeTime(createdAt: number, now: number): string {
  const dayMs = 24 * 60 * 60 * 1000;
  // Normalize to local-midnight day boundaries so "yesterday" matches calendar
  // expectations rather than a strict 24h slide.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfCreated = new Date(createdAt);
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
  const created = new Date(createdAt);
  const sameYear = created.getFullYear() === new Date(now).getFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return created.toLocaleDateString(undefined, opts);
}

export function FavoritesPanel({
  isOpen,
  onClose,
  onAskAgain,
}: FavoritesPanelProps) {
  const { favorites } = useFavorites();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
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
    if (!isOpen) {
      setExpandedIds(new Set());
      setConfirmingClear(false);
    }
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

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
    clearFavorites();
    setConfirmingClear(false);
    setExpandedIds(new Set());
  };

  const handleAskAgain = (content: string) => {
    onAskAgain?.(content);
    onClose();
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
        aria-labelledby="favorites-title"
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

        <div className="px-4 pb-2 flex items-center justify-between gap-3">
          <h2
            id="favorites-title"
            className="text-lg font-bold text-stone-800"
          >
            Saved ({favorites.length})
          </h2>
          {/* Close comes first in DOM order: it gets focus on open (not the
              destructive Clear all), and touch screen-reader users, who
              can't reach the aria-hidden backdrop or press Escape, get a way out. */}
          <div className="flex flex-row-reverse items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close saved favorites"
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
            {favorites.length > 0 && (
              <button
                type="button"
                onClick={handleClearClick}
                aria-label={
                  confirmingClear
                    ? 'Confirm clear all favorites'
                    : 'Clear all favorites'
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

        <div className="overflow-y-auto px-4 pb-6 max-h-[65vh] modal-scroll">
          {favorites.length === 0 ? (
            <EmptyState
              icon="🤍"
              title="No favorites yet"
              description="Tap the heart on any jAIsus message to save it here."
            />
          ) : (
            <ul className="pt-2" role="list">
              {favorites.map(fav => {
                const isExpanded = expandedIds.has(fav.id);
                const isLong = fav.content.length > TRUNCATE_THRESHOLD;
                const displayedContent =
                  isLong && !isExpanded ? truncate(fav.content) : fav.content;

                return (
                  <li
                    key={fav.id}
                    className="bg-stone-50 rounded-xl border border-stone-200 p-3 mb-2"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Top row: kind chip + relative date */}
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${KIND_CHIP_CLASSES[fav.kind]}`}
                          >
                            {KIND_LABEL[fav.kind]}
                          </span>
                          <span
                            className="text-xs text-stone-400 shrink-0"
                            title={new Date(fav.createdAt).toLocaleString()}
                          >
                            {relativeTime(fav.createdAt, now)}
                          </span>
                        </div>

                        {/* Body */}
                        <p className="text-sm text-stone-700 whitespace-pre-wrap break-words">
                          {displayedContent}
                          {isLong && (
                            <>
                              {' '}
                              <button
                                type="button"
                                onClick={() => toggleExpanded(fav.id)}
                                className="text-xs font-medium text-teal-600 hover:underline"
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? 'Show less' : 'Show more'}
                              </button>
                            </>
                          )}
                        </p>

                        {/* Context */}
                        {fav.context && (
                          <p className="text-xs text-stone-500 italic mt-1.5">
                            {fav.context}
                          </p>
                        )}
                      </div>

                      {/* Right-side actions */}
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (!removeFavorite(fav.id)) {
                              toast.error("Couldn't remove it — storage unavailable");
                            }
                          }}
                          aria-label="Remove from favorites"
                          className="w-11 h-11 flex items-center justify-center rounded-full text-stone-500 hover:text-rose-600 hover:bg-rose-50 active:scale-[0.95] transition-all"
                        >
                          <svg
                            className="w-4 h-4"
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
                        {onAskAgain && (
                          <button
                            type="button"
                            onClick={() => handleAskAgain(fav.content)}
                            aria-label="Ask jAIsus about this again"
                            className="w-11 h-11 flex items-center justify-center rounded-full text-stone-500 hover:text-teal-600 hover:bg-teal-50 active:scale-[0.95] transition-all"
                          >
                            <svg
                              className="w-4 h-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M7 17L17 7" />
                              <path d="M7 7h10v10" />
                            </svg>
                          </button>
                        )}
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
