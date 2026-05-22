'use client';

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { searchAll, type SearchResult, type SearchSource } from '@/lib/search';
import { EmptyState } from '@/components/EmptyState';

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when the user picks a chat result to ask jAIsus about it again. */
  onAskAbout?: (content: string) => void;
}

const DEBOUNCE_MS = 150;

const QUICK_TIPS: { label: string; query: string }[] = [
  { label: "Try searching for 'love'", query: 'love' },
  { label: "Or a theme like 'forgiveness'", query: 'forgiveness' },
  { label: "Or a name like 'Samaritan'", query: 'Samaritan' },
];

const SOURCE_CHIP_CLASSES: Record<SearchSource, string> = {
  chat: 'bg-blue-100 text-blue-800',
  favorite: 'bg-rose-100 text-rose-700',
  parable: 'bg-amber-100 text-amber-800',
};

const SOURCE_LABEL: Record<SearchSource, string> = {
  chat: 'chat',
  favorite: 'saved',
  parable: 'parable',
};

/**
 * Render `text` with every case-insensitive occurrence of any term in
 * `query` wrapped in <mark>. Returns plain JSX — no dangerouslySetInnerHTML,
 * so the React reconciler escapes content for us.
 */
function HighlightedText({
  text,
  query,
}: {
  text: string;
  query: string;
}): JSX.Element {
  const trimmed = query.trim();
  const segments = useMemo(() => {
    if (trimmed.length < 2) return [{ text, match: false }];
    const terms = trimmed.split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) return [{ text, match: false }];
    const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = text.split(re);
    // Split with capture groups yields [non-match, match, non-match, match, ...]
    return parts.map((part, i) => ({ text: part, match: i % 2 === 1 }));
  }, [text, trimmed]);

  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="bg-amber-200 text-stone-900 rounded px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        )
      )}
    </>
  );
}

export function SearchPanel({
  isOpen,
  onClose,
  onAskAbout,
}: SearchPanelProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset transient state when the panel closes — re-opening is clean.
  useEffect(() => {
    if (isOpen) return;
    setQuery('');
    setDebouncedQuery('');
  }, [isOpen]);

  // Focus the input when the panel opens. useModalA11y will trap and trace
  // focus generally, but it picks the first focusable element — we want the
  // search input specifically.
  useEffect(() => {
    if (!isOpen) return;
    // rAF so the input is visible before we yank focus to it (avoids the
    // mobile keyboard popping up before the drawer finishes its slide-in).
    const handle = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [isOpen]);

  // Debounce the query — typing fast shouldn't re-search on every keystroke.
  useEffect(() => {
    if (query === debouncedQuery) return;
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, debouncedQuery]);

  const trimmed = debouncedQuery.trim();
  const hasQuery = trimmed.length >= 2;
  // Audit fix: compare untrimmed values. The debounce effect (above) tracks
  // raw `query`, so a trailing-whitespace edit IS still pending; comparing
  // trimmed values would say "in sync" and skip the "Searching..." indicator.
  const isDebouncing = query !== debouncedQuery;

  // Audit fix: results were memoized only on [trimmed, hasQuery] — so if a
  // favorite was deleted or a chat thread was cleared while the panel was
  // open, the displayed results would point at items that no longer exist.
  // We now bump a `storageTick` whenever a relevant store changes so the
  // useMemo re-derives. searchAll() already reads localStorage fresh.
  const [storageTick, setStorageTick] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === 'undefined') return;
    const bump = () => setStorageTick((t) => t + 1);
    const onStorage = (e: StorageEvent) => {
      const key = e.key;
      if (
        key === null ||
        key === 'jaisus-favorites' ||
        key === 'jaisus-chat-history' ||
        key === 'jaisus-voice-memos'
      ) {
        bump();
      }
    };
    window.addEventListener('jaisus-favorites-changed', bump);
    window.addEventListener('jaisus-chat-history-changed', bump);
    window.addEventListener('jaisus-voice-memos-changed', bump);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('jaisus-favorites-changed', bump);
      window.removeEventListener('jaisus-chat-history-changed', bump);
      window.removeEventListener('jaisus-voice-memos-changed', bump);
      window.removeEventListener('storage', onStorage);
    };
  }, [isOpen]);

  const results: SearchResult[] = useMemo(
    () => (hasQuery ? searchAll(trimmed) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trimmed, hasQuery, storageTick]
  );

  const handleSelect = (result: SearchResult) => {
    if (result.source === 'chat' && onAskAbout) {
      // Send the FULL original message text, not the truncated excerpt.
      // `result.text` is the display-only excerpt with ellipses; using it
      // for the prompt would feed jAIsus "…clipped middle…" instead of the
      // actual content the user wants to ask about.
      onAskAbout(result.fullText);
    }
    onClose();
  };

  const handleClear = () => {
    setQuery('');
    setDebouncedQuery('');
    inputRef.current?.focus();
  };

  return (
    <div
      className={`fixed inset-0 z-50 transition-all duration-300 ${
        isOpen ? 'visible' : 'invisible'
      }`}
      aria-hidden={!isOpen}
      // Audit fix: `inert` removes the whole subtree from the tab order and
      // pointer events. Previously the input + buttons stayed tab-reachable
      // for the 300ms close transition with aria-hidden=true on an ancestor,
      // which axe-core flags as a serious "aria-hidden-focus" violation.
      inert={!isOpen}
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
        aria-labelledby="search-title"
        className={`absolute bottom-0 left-0 right-0 max-h-[85vh] bg-white rounded-t-2xl shadow-2xl
          transition-transform duration-300 ease-out ${
            isOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div
            className="w-10 h-1 rounded-full bg-stone-300"
            aria-hidden="true"
          />
        </div>

        {/* Header */}
        <div className="px-4 pb-3">
          <h2 id="search-title" className="text-lg font-bold text-stone-800">
            Search
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Find anything from your chats, saved hearts, or parables.
          </p>

          {/* Search input */}
          <div className="relative mt-3">
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
              aria-hidden="true"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </span>
            <label htmlFor="search-input" className="sr-only">
              Search your chats, favorites, and parables
            </label>
            <input
              ref={inputRef}
              id="search-input"
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search..."
              className="w-full rounded-lg border border-stone-200 bg-white pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 active:scale-[0.95] transition-all"
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
            )}
          </div>
        </div>

        {/* Results / tips / empty state */}
        <div
          className="overflow-y-auto px-4 pb-6 max-h-[65vh] modal-scroll"
          role="region"
          aria-live="polite"
          aria-busy={isDebouncing}
        >
          {!hasQuery ? (
            <ul className="pt-2 space-y-1" role="list">
              {QUICK_TIPS.map(tip => (
                <li key={tip.query}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(tip.query);
                      // Skip the debounce — the user explicitly picked this.
                      setDebouncedQuery(tip.query);
                      inputRef.current?.focus();
                    }}
                    className="w-full flex items-center gap-2 text-left rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-700 active:scale-[0.99] transition-transform"
                  >
                    <span
                      className="text-stone-400 shrink-0"
                      aria-hidden="true"
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" />
                      </svg>
                    </span>
                    <span className="flex-1 min-w-0">{tip.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : isDebouncing ? (
            <p
              className="pt-6 text-center text-sm text-stone-400"
              role="status"
            >
              Searching…
            </p>
          ) : results.length === 0 ? (
            <EmptyState
              icon="🔎"
              title="Nothing found"
              description={`No matches for "${trimmed}"`}
            />
          ) : (
            <ul className="pt-2" role="list">
              {results.map(result => {
                const isChat = result.source === 'chat';
                const isInteractive = isChat && !!onAskAbout;
                return (
                  <li key={result.id} className="mb-2">
                    <button
                      type="button"
                      onClick={() => handleSelect(result)}
                      aria-label={
                        isInteractive
                          ? `Ask jAIsus about this chat result: ${result.text}`
                          : `${SOURCE_LABEL[result.source]} result: ${result.text}`
                      }
                      className="w-full bg-stone-50 rounded-xl border border-stone-200 p-3 text-left active:scale-[0.99] hover:bg-stone-100 transition-all"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_CHIP_CLASSES[result.source]}`}
                        >
                          {SOURCE_LABEL[result.source]}
                        </span>
                        {result.context && (
                          <span className="text-xs text-stone-500 truncate min-w-0">
                            {result.context}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-stone-700 leading-relaxed break-words">
                        <HighlightedText
                          text={result.text}
                          query={trimmed}
                        />
                      </p>
                    </button>
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
