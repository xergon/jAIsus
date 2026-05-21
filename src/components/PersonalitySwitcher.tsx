'use client';

import { useEffect, useRef, useCallback, useState, useMemo, type KeyboardEvent } from 'react';
import { PERSONALITIES, type Personality } from '@/lib/personalities';
import { listCustomPersonalities, CUSTOM_CHANGED_EVENT } from '@/lib/custom-personalities';
import { useHaptics } from '@/hooks/useHaptics';

interface PersonalitySwitcherProps {
  /** Currently active personality ID */
  activeId: string;
  /** Called when user picks a different personality. Parent should call setStoredPersonalityId + update its own state. */
  onChange: (newId: string) => void;
  className?: string;
}

/**
 * Compact horizontal chip strip for fast personality switching.
 *
 * Renders all 9 personalities as scroll-snapping emoji+name chips. Tapping
 * a non-active chip immediately fires `onChange` (and a tap haptic). Tapping
 * the already-active chip is a no-op. When `activeId` changes externally
 * (e.g. from Settings), the active chip is scrolled into view smoothly.
 *
 * Implements a roving-tabindex radiogroup: arrow keys move focus and
 * activate the option (with wrap-around at the ends), Space/Enter also
 * activate, and only the active chip is in the tab order.
 */
export function PersonalitySwitcher({
  activeId,
  onChange,
  className = '',
}: PersonalitySwitcherProps) {
  const { vibrate } = useHaptics();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Hydrate user-authored custom personalities and keep them in sync via the
  // shared CustomEvent + cross-tab `storage` event. Starts empty so SSR + the
  // initial client render agree (built-ins only), then expands on mount.
  const [customList, setCustomList] = useState<Personality[]>([]);
  useEffect(() => {
    const refresh = () => setCustomList(listCustomPersonalities());
    refresh();
    if (typeof window === 'undefined') return;
    window.addEventListener(CUSTOM_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CUSTOM_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Built-ins first, custom after — keeps the familiar order stable and lets
  // users browse left-to-right from kindest to edgiest, then "yours".
  const allPersonalities = useMemo(
    () => [...PERSONALITIES, ...customList],
    [customList]
  );

  // Re-size the ref array in an effect, NOT during render. Mutating refs
  // during render violates React 19's render-purity contract and concurrent
  // rendering can drop refs assigned by callback refs in the same pass.
  useEffect(() => {
    if (buttonRefs.current.length !== allPersonalities.length) {
      buttonRefs.current.length = allPersonalities.length;
    }
  }, [allPersonalities.length]);

  const activeIndex = allPersonalities.findIndex(p => p.id === activeId);
  // During SSR/hydration the active id might be a custom one that hasn't
  // hydrated yet — activeIndex would be -1 and EVERY chip would get
  // tabIndex=-1, locking keyboard users out of the radiogroup. Fall back
  // to the first chip in that transient window so the group stays usable.
  const focusableIndex = activeIndex >= 0 ? activeIndex : 0;

  // When activeId changes (including from external sources like Settings),
  // bring the active chip into view. Use `nearest` block to avoid vertical
  // page jumps; `center` inline keeps the chip nicely framed horizontally.
  useEffect(() => {
    if (activeIndex < 0) return;
    const btn = buttonRefs.current[activeIndex];
    if (!btn) return;
    btn.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [activeIndex]);

  const selectByIndex = useCallback(
    (index: number) => {
      const target = allPersonalities[index];
      if (!target) return;
      if (target.id === activeId) return; // no-op on already-active
      vibrate('tap');
      onChange(target.id);
    },
    [activeId, onChange, vibrate, allPersonalities]
  );

  const handleKeyDown = useCallback(
    // `allPersonalities` is intentionally a dep — when custom personalities
    // are added/removed the wrap-around bounds must use the current length,
    // not the stale closure length.
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown': {
          e.preventDefault();
          const next = (index + 1) % allPersonalities.length;
          buttonRefs.current[next]?.focus();
          selectByIndex(next);
          break;
        }
        case 'ArrowLeft':
        case 'ArrowUp': {
          e.preventDefault();
          const prev =
            (index - 1 + allPersonalities.length) % allPersonalities.length;
          buttonRefs.current[prev]?.focus();
          selectByIndex(prev);
          break;
        }
        case ' ':
        case 'Enter': {
          e.preventDefault();
          selectByIndex(index);
          break;
        }
        case 'Home': {
          e.preventDefault();
          buttonRefs.current[0]?.focus();
          selectByIndex(0);
          break;
        }
        case 'End': {
          e.preventDefault();
          const last = allPersonalities.length - 1;
          buttonRefs.current[last]?.focus();
          selectByIndex(last);
          break;
        }
        default:
          break;
      }
    },
    [selectByIndex, allPersonalities]
  );

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label="Personality"
      className={[
        'flex gap-2 px-4 py-1',
        'overflow-x-auto scroll-smooth snap-x',
        '[-ms-overflow-style:none] [scrollbar-width:none]',
        '[&::-webkit-scrollbar]:hidden',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {allPersonalities.map((p, i) => {
        const isActive = p.id === activeId;
        return (
          <button
            key={p.id}
            ref={el => {
              buttonRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-pressed={isActive}
            aria-label={`${p.name} — ${p.desc}`}
            tabIndex={i === focusableIndex ? 0 : -1}
            onClick={() => selectByIndex(i)}
            onKeyDown={e => handleKeyDown(e, i)}
            className={[
              'snap-start shrink-0',
              'inline-flex items-center gap-1.5',
              'min-w-[44px] h-11 px-3',
              'rounded-full',
              'text-xs font-medium',
              'transition-all duration-150 ease-out',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70',
              isActive
                ? 'bg-amber-100 border-2 border-amber-500 text-amber-900 scale-105 shadow-sm'
                : 'bg-white border border-stone-200 text-stone-600 hover:border-amber-300 active:scale-95',
            ].join(' ')}
          >
            <span aria-hidden="true" className="text-base leading-none">
              {p.emoji}
            </span>
            <span className="hidden sm:inline">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}
