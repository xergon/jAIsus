'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useConversationMemory } from '@/hooks/useConversationMemory';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useModalA11y } from '@/hooks/useModalA11y';
import { getPersonality } from '@/lib/personalities';
import { getCustomPersonality, isCustomId } from '@/lib/custom-personalities';
import {
  FACT_CATEGORIES,
  FACT_CATEGORY_LABELS,
  MAX_NAME_CHARS,
  cleanName,
  forgetEverything,
  getProfile,
  removeFact,
  setProfileName,
} from '@/lib/user-profile';
import { EmptyState } from '@/components/EmptyState';

interface MemoriesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Also clears the chat on screen: it still holds what was just forgotten,
   *  and it is sent with every message, so jAIsus would keep "knowing" it. */
  onForgetEverything?: () => void;
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

/**
 * Two-tap confirm for a destructive button: the first tap arms it for 3 s,
 * `tap()` returns true on the confirming second one. Closing the sheet
 * disarms it.
 */
function useConfirm(isOpen: boolean) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adjusted during render (React's "store info from previous renders"
  // pattern); the timer is cleared in the effect below.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (!isOpen) setArmed(false);
  }
  useEffect(() => {
    if (isOpen) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [isOpen]);

  // Cleanup pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const tap = (): boolean => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!armed) {
      setArmed(true);
      timerRef.current = setTimeout(() => {
        setArmed(false);
        timerRef.current = null;
      }, 3000);
      return false;
    }
    setArmed(false);
    return true;
  };
  return { armed, tap };
}

export function MemoriesPanel({ isOpen, onClose, onForgetEverything }: MemoriesPanelProps) {
  const { memories, removeMemory, clearMemories } = useConversationMemory();
  const profile = useUserProfile();
  const dialogRef = useRef<HTMLDivElement>(null);
  const profileTitleRef = useRef<HTMLHeadingElement>(null);
  const factsRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });

  const clearConfirm = useConfirm(isOpen);
  const forgetConfirm = useConfirm(isOpen);

  // Name field: a draft until saved. Follows the stored name when it changes
  // (learned in the background, another tab, Forget everything). Adjusted
  // during render (React's "store info from previous renders" pattern).
  const [nameDraft, setNameDraft] = useState(profile.name ?? '');
  const [nameMessage, setNameMessage] = useState('');
  const [seenName, setSeenName] = useState(profile.name);
  if (profile.name !== seenName) {
    setSeenName(profile.name);
    setNameDraft(profile.name ?? '');
  }
  const nameChanged = nameDraft.trim() !== (profile.name ?? '');

  // Pin "now" so relative times don't churn on every render. Refreshed on the
  // first frame after the panel opens (good enough — drawer is short-lived).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // When closing, drop an unsaved name edit so re-opening is clean.
  // Adjusted during render (React's "store info from previous renders"
  // pattern).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setNameDraft(profile.name ?? '');
      setNameMessage('');
    }
  }

  const handleClearClick = () => {
    if (clearConfirm.tap()) clearMemories();
  };

  const handleForgetClick = () => {
    if (!forgetConfirm.tap()) return;
    forgetEverything();
    onForgetEverything?.();
    setNameMessage('jAIsus has forgotten everything.');
    // The button is gone now; keep focus in the sheet. On the heading, not
    // the name field: focusing a text input pops up the phone keyboard.
    profileTitleRef.current?.focus();
  };

  const handleSaveName = (e: FormEvent) => {
    e.preventDefault();
    const draft = nameDraft.trim();
    const cleaned = draft ? cleanName(draft) : null;
    if (draft && !cleaned) {
      setNameMessage(`Use letters only, up to ${MAX_NAME_CHARS} characters.`);
      return;
    }
    if (!setProfileName(cleaned)) {
      setNameMessage("Couldn't save on this device.");
      return;
    }
    // Show what was actually stored ("Anna!" → "Anna"). When that equals the
    // old name nothing is emitted, so the stored-name sync above won't reset
    // the field and Save would stay enabled on the raw text.
    setNameDraft(getProfile().name ?? '');
    setNameMessage(cleaned ? 'Saved.' : 'Name removed.');
  };

  const handleRemoveFact = (id: string, index: number) => {
    removeFact(id);
    // The button is gone; move focus to the next fact's (or the previous
    // one's), else the section heading (not the name field, which would pop
    // up the phone keyboard), instead of losing it to the page.
    requestAnimationFrame(() => {
      const buttons = factsRef.current?.querySelectorAll<HTMLButtonElement>('[data-fact-delete]');
      (buttons?.[index] ?? buttons?.[index - 1] ?? profileTitleRef.current)?.focus();
    });
  };

  // Facts grouped by topic, newest first within each.
  const groups = FACT_CATEGORIES.map(category => ({
    category,
    facts: profile.facts
      .filter(f => f.category === category)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  })).filter(g => g.facts.length > 0);
  // Each fact's place in display order, for moving focus after a delete.
  const factOrder = new Map(groups.flatMap(g => g.facts).map((f, i) => [f.id, i]));
  const hasAnything = !!profile.name || profile.facts.length > 0 || memories.length > 0;

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

        {/* Close is the first control in DOM order: it gets focus on open
            (not a destructive button), and touch screen-reader users, who
            can't reach the aria-hidden backdrop or press Escape, get a way
            out. */}
        <div className="px-4 pb-1 flex items-center justify-between gap-3">
          <h2
            id="memories-title"
            className="text-lg font-bold text-stone-800"
          >
            Memories
          </h2>
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
        </div>

        <p className="px-4 text-xs text-stone-500 mt-1 pb-2">
          What jAIsus remembers about you and your past conversations, so the
          next one feels like a continuation. Stored only on this device.
        </p>

        <div className="overflow-y-auto px-4 pb-6 max-h-[65vh] modal-scroll">
          {/* What jAIsus knows about you: name + learned facts */}
          <section aria-labelledby="memories-profile-title" className="pt-2">
            {/* Focus target after a delete (tabIndex -1: not a tab stop). */}
            <h3
              ref={profileTitleRef}
              id="memories-profile-title"
              tabIndex={-1}
              className="text-sm font-semibold text-stone-800 focus:outline-none"
            >
              What jAIsus knows about you
            </h3>

            <form onSubmit={handleSaveName} className="mt-2">
              <label
                htmlFor="memories-name"
                className="block text-xs text-stone-500 mb-1"
              >
                Your name
              </label>
              <div className="flex items-center gap-2">
                {/* 16px text, or iOS zooms the page in on focus. */}
                <input
                  id="memories-name"
                  type="text"
                  value={nameDraft}
                  onChange={e => {
                    setNameDraft(e.target.value);
                    setNameMessage('');
                  }}
                  maxLength={MAX_NAME_CHARS}
                  placeholder="What should jAIsus call you?"
                  autoComplete="given-name"
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  className="flex-1 min-w-0 min-h-11 rounded-xl border border-stone-300 bg-white px-3 py-2 text-base
                    focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                />
                <button
                  type="submit"
                  disabled={!nameChanged}
                  className="shrink-0 min-h-11 rounded-xl bg-teal-500 px-4 text-sm font-semibold text-white active:scale-95 transition-transform disabled:opacity-40"
                >
                  Save
                </button>
              </div>
              <p
                role="status"
                aria-live="polite"
                className="mt-1 min-h-4 text-xs text-stone-500"
              >
                {nameMessage}
              </p>
            </form>

            {groups.length === 0 ? (
              <p className="mt-1 text-sm text-stone-500 leading-relaxed">
                Nothing yet. As you talk, jAIsus remembers the important things
                you share — the people you love, what you&apos;re going
                through, what you hope and pray for.
              </p>
            ) : (
              <div ref={factsRef}>
                {groups.map(group => (
                  <div key={group.category} className="mt-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1.5">
                      {FACT_CATEGORY_LABELS[group.category]}
                    </h4>
                    <ul className="space-y-1.5" role="list">
                      {group.facts.map(fact => {
                        const index = factOrder.get(fact.id) ?? 0;
                        return (
                          <li
                            key={fact.id}
                            className="flex items-center gap-1 bg-stone-50 rounded-xl border border-stone-200 pl-3"
                          >
                            <p className="flex-1 min-w-0 py-2 text-sm text-stone-700 leading-snug [overflow-wrap:anywhere]">
                              {fact.text}
                            </p>
                            <button
                              type="button"
                              data-fact-delete
                              onClick={() => handleRemoveFact(fact.id, index)}
                              aria-label={`Forget: ${fact.text}`}
                              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-stone-400 hover:text-rose-600 hover:bg-rose-50 active:scale-95 transition-all"
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
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {hasAnything && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleForgetClick}
                  aria-label={
                    forgetConfirm.armed
                      ? 'Confirm: forget everything jAIsus remembers'
                      : 'Forget everything jAIsus remembers'
                  }
                  aria-describedby="memories-forget-hint"
                  className={`w-full min-h-11 rounded-xl border text-sm active:scale-[0.98] transition-transform ${
                    forgetConfirm.armed
                      ? 'border-rose-300 bg-rose-50 text-rose-700 font-semibold'
                      : 'border-stone-200 text-rose-600 hover:bg-rose-50'
                  }`}
                >
                  {forgetConfirm.armed ? 'Sure? Tap again to forget everything' : 'Forget everything'}
                </button>
                <p id="memories-forget-hint" className="mt-1 text-xs text-stone-400 text-center">
                  Your name, everything above, the conversation summaries below and the current chat.
                </p>
              </div>
            )}
          </section>

          {/* Past conversations: one summary each */}
          <section aria-labelledby="memories-conversations-title" className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h3
                id="memories-conversations-title"
                className="text-sm font-semibold text-stone-800"
              >
                Past conversations ({memories.length})
              </h3>
              {memories.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearClick}
                  aria-label={
                    clearConfirm.armed
                      ? 'Confirm clear all conversation summaries'
                      : 'Clear all conversation summaries'
                  }
                  className={`min-h-11 px-1 text-xs ${
                    clearConfirm.armed
                      ? 'text-rose-700 font-semibold'
                      : 'text-rose-600 hover:underline'
                  } active:scale-[0.98] transition-transform`}
                >
                  {clearConfirm.armed ? 'Sure? Tap again to confirm' : 'Clear all'}
                </button>
              )}
            </div>

            {memories.length === 0 ? (
              <EmptyState
                icon="✨"
                title="No conversations yet"
                description="As you talk, jAIsus keeps a one-line summary of each conversation here, so future sessions feel like a continuation."
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
          </section>
        </div>
      </div>
    </div>
  );
}
