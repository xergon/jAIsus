'use client';

import type { JSX } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * One row in a {@link ContextMenu}. Items render in the order given.
 *
 * - `icon` is rendered before the label; pass any ReactNode (emoji, SVG…).
 * - `destructive` swaps the row palette to rose tones — use for "delete" etc.
 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}

export interface ContextMenuProps {
  /** Whether the menu is open */
  isOpen: boolean;
  /** Position to anchor the menu. Pass page coordinates (clientX/clientY). */
  position: { x: number; y: number } | null;
  /** Menu items */
  items: ContextMenuItem[];
  /** Called when user dismisses (backdrop click, Escape, or item picked) */
  onClose: () => void;
}

// Inset from the viewport edge so the menu never touches the corner.
const VIEWPORT_MARGIN = 8;

/**
 * Resolve the final (top, left) position for the menu given the pointer
 * location and the menu's measured bounding box, clamped to the viewport.
 *
 * The menu starts at the pointer; if that would push it off-screen, we shift
 * it leftward / upward by the overflow amount. We never go below the margin.
 */
function clampPosition(
  pointer: { x: number; y: number },
  size: { width: number; height: number }
): { left: number; top: number } {
  // SSR / pre-mount safety: bail out to the pointer position if window is
  // missing (consumers will only paint on the client, but be defensive).
  if (typeof window === 'undefined') {
    return { left: pointer.x, top: pointer.y };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = pointer.x;
  let top = pointer.y;

  // Right/bottom overflow: shift back so the menu fits inside the margin.
  if (left + size.width + VIEWPORT_MARGIN > vw) {
    left = vw - size.width - VIEWPORT_MARGIN;
  }
  if (top + size.height + VIEWPORT_MARGIN > vh) {
    top = vh - size.height - VIEWPORT_MARGIN;
  }

  // Left/top edge floor — handles tiny viewports where the menu is wider
  // than the screen after the shift above.
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

  return { left, top };
}

/**
 * Anchored, keyboard-navigable context menu for chat messages.
 *
 * Behavior:
 * - Backdrop is a faint (`bg-black/20`) overlay; clicking it closes.
 * - Position is anchored at `position.x/y` (page coordinates) and clamped so
 *   the menu never overflows the viewport — we measure the bound box after
 *   first paint with `useLayoutEffect` so the very first frame is positioned
 *   off-screen and faded out, then the second frame snaps to the clamped
 *   coordinates and fades in.
 * - Open animation: 120ms fade + scale from 0.95 → 1.0 (CSS transitions on
 *   `opacity` and `transform`).
 * - Keyboard: ArrowUp/ArrowDown move focus between items (wrap-around),
 *   Tab / Shift+Tab cycle focus, Escape closes, Enter / Space activates.
 * - First menuitem is focused on open.
 * - Item clicks call the item's `onClick`, then `onClose`.
 */
export function ContextMenu({
  isOpen,
  position,
  items,
  onClose,
}: ContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // The clamped position is null until we've measured the menu. Rendering
  // with `visibility: hidden` for the first frame lets us read the bounds
  // without showing the menu at the wrong location.
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null
  );
  // Animation gate — flipped to `true` one frame after coords are set so the
  // CSS transition runs.
  const [animateIn, setAnimateIn] = useState(false);

  // Audit fix: mutating refs during render violates React 19's render-purity
  // contract — under StrictMode / concurrent rendering, a discarded render
  // pass would leave the ref array out of sync with the committed tree.
  // Move the length sync into an effect that runs after commit, so the ref
  // callback at the button below always sees the right length.
  useEffect(() => {
    if (itemRefs.current.length !== items.length) {
      itemRefs.current.length = items.length;
    }
  }, [items.length]);

  // Reset when the menu closes, so the next open measures afresh and fades
  // in again. Done while rendering (React's "adjust state when a prop
  // changes" pattern) rather than with a setState in the effect below.
  const open = isOpen && position !== null;
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setCoords(null);
      setAnimateIn(false);
    }
  }

  // Measure & clamp the menu's position once it's in the DOM. We use
  // useLayoutEffect so the position is applied before the user sees the
  // first paint.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!isOpen || !position || !menu) return;
    // offsetWidth/Height are the layout size. getBoundingClientRect would
    // include the scale(0.95) of the open animation, so the full-size menu
    // ended up a few px past the right/bottom edge.
    setCoords(
      clampPosition(position, { width: menu.offsetWidth, height: menu.offsetHeight })
    );
    // Schedule the transition to start on the next frame so the browser
    // commits the initial (pre-animation) styles first.
    const raf = requestAnimationFrame(() => setAnimateIn(true));
    return () => cancelAnimationFrame(raf);
  }, [isOpen, position, items.length]);

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (!isOpen) return;
    // Wait a tick so the items are mounted.
    const id = requestAnimationFrame(() => {
      const first = itemRefs.current.find(el => el !== null);
      first?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen, items.length]);

  // Move focus to the item at `index`, wrapping around. Indexes that point
  // past the array or at `null` slots are skipped by looping until we hit a
  // valid element (or run out, which can't happen if items.length > 0).
  const focusItemAt = useCallback(
    (index: number) => {
      const len = items.length;
      if (len === 0) return;
      // Normalize to a positive in-range index.
      let i = ((index % len) + len) % len;
      // Bail after one full lap to avoid infinite loops if every slot is null.
      for (let tries = 0; tries < len; tries++) {
        const el = itemRefs.current[i];
        if (el) {
          el.focus();
          return;
        }
        i = (i + 1) % len;
      }
    },
    [items.length]
  );

  // Keyboard handler: ArrowUp/Down navigation, Escape close, Tab focus trap.
  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Figure out which item index currently has focus so we can advance
      // relative to it (or fall back to 0 / -1 for first arrow press).
      const active = document.activeElement as HTMLElement | null;
      const currentIndex = itemRefs.current.findIndex(el => el === active);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusItemAt(currentIndex < 0 ? 0 : currentIndex + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusItemAt(currentIndex < 0 ? items.length - 1 : currentIndex - 1);
        return;
      }

      if (e.key === 'Tab') {
        // Trap focus inside the menu.
        const len = items.length;
        if (len === 0) return;
        const lastIndex = len - 1;
        if (e.shiftKey) {
          // Shift+Tab on the first item wraps to the last.
          if (currentIndex <= 0) {
            e.preventDefault();
            focusItemAt(lastIndex);
          }
        } else {
          // Tab on the last item wraps to the first.
          if (currentIndex === lastIndex) {
            e.preventDefault();
            focusItemAt(0);
          } else if (currentIndex < 0) {
            // Focus drifted outside (shouldn't happen) — pull it back.
            e.preventDefault();
            focusItemAt(0);
          }
        }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, items.length, focusItemAt, onClose]);

  // Stable handler for an item's click — calls its onClick, then closes.
  const handleItemActivate = useCallback(
    (item: ContextMenuItem) => {
      item.onClick();
      onClose();
    },
    [onClose]
  );

  // Inline transform style for the open/close animation. Kept in a memo so
  // React doesn't churn the style object every render.
  const animationStyle = useMemo<React.CSSProperties>(
    () => ({
      opacity: animateIn ? 1 : 0,
      transform: animateIn ? 'scale(1)' : 'scale(0.95)',
      transition: 'opacity 120ms ease-out, transform 120ms ease-out',
      transformOrigin: 'top left',
    }),
    [animateIn]
  );

  if (!isOpen || !position) return null;

  return (
    <div
      // Light backdrop — fixed, full-viewport, click-to-close. We deliberately
      // use a low-opacity black instead of a full overlay because this menu is
      // a quick-action affordance, not a modal: the surrounding content should
      // remain visible.
      className="fixed inset-0 z-50 bg-black/20"
      onClick={onClose}
      // Block contextmenu on the backdrop so a quick right-click after the
      // menu opens doesn't trigger a second native menu underneath.
      onContextMenu={e => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label="Message actions"
        aria-orientation="vertical"
        // We position absolutely against the fixed backdrop. `coords` is null
        // on the first frame (we render off-screen to measure), then we snap
        // to the clamped position on the next layout pass.
        style={{
          position: 'absolute',
          left: coords?.left ?? -9999,
          top: coords?.top ?? -9999,
          visibility: coords ? 'visible' : 'hidden',
          ...animationStyle,
        }}
        // Don't let clicks on the menu bubble up and close it via the backdrop
        // handler above.
        onClick={e => e.stopPropagation()}
        onContextMenu={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-stone-200 py-1 min-w-[200px]"
      >
        {items.map((item, index) => {
          const destructive = item.destructive === true;
          return (
            <button
              key={item.id}
              ref={el => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              onClick={() => handleItemActivate(item)}
              className={[
                'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left min-h-[44px]',
                'focus:outline-none',
                destructive
                  ? 'text-rose-600 hover:bg-rose-50 active:bg-rose-100 focus-visible:bg-rose-50'
                  : 'text-stone-800 hover:bg-stone-50 active:bg-stone-100 focus-visible:bg-stone-50',
              ].join(' ')}
            >
              {item.icon !== undefined && (
                <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="flex-1">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
