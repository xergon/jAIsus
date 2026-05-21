'use client';

import { useEffect, useRef } from 'react';

/**
 * Accessibility behaviors that every modal/drawer/sheet should have:
 *  1. Body scroll lock — the page behind the modal doesn't scroll on iOS
 *     (where the default `overflow:hidden` workaround doesn't work).
 *  2. Escape key dismisses — keyboard users need a way out.
 *  3. Focus trap — Tab/Shift+Tab cycles only within the modal so screen
 *     reader and keyboard users don't lose context.
 *  4. Focus restore — when the modal closes, focus returns to whatever
 *     opened it (the original button), not the page root.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useModalA11y({ isOpen, onClose, ref });
 *   return <div ref={ref} role="dialog" aria-modal="true" ...>
 */
export interface UseModalA11yOptions {
  isOpen: boolean;
  onClose: () => void;
  ref: React.RefObject<HTMLElement | null>;
}

export function useModalA11y({ isOpen, onClose, ref }: UseModalA11yOptions) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Body scroll lock + capture previously-focused element
  useEffect(() => {
    if (!isOpen) return;
    // Remember focus to restore on close
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    // iOS-safe scroll lock: fix the body in place. `overflow:hidden` alone
    // is ignored by iOS Safari which lets the page underneath scroll.
    const scrollY = window.scrollY;
    const bodyStyle = document.body.style;
    const prevPosition = bodyStyle.position;
    const prevTop = bodyStyle.top;
    const prevWidth = bodyStyle.width;
    bodyStyle.position = 'fixed';
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.width = '100%';

    return () => {
      bodyStyle.position = prevPosition;
      bodyStyle.top = prevTop;
      bodyStyle.width = prevWidth;
      window.scrollTo(0, scrollY);
      // Restore focus
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isOpen]);

  // Escape key + focus trap
  useEffect(() => {
    if (!isOpen) return;
    const root = ref.current;
    if (!root) return;

    // Move focus into the modal on open (first focusable element)
    const focusables = getFocusable(root);
    focusables[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = ref.current;
      if (!root) return;
      const items = getFocusable(root);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, ref]);
}

/** Returns all visible, tab-focusable descendants of `root` in DOM order. */
function getFocusable(root: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    el => !el.hasAttribute('aria-hidden') && el.offsetParent !== null
  );
}
