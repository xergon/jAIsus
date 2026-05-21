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

// Module-level scroll-lock state: counts how many modals are open and
// remembers the "natural" body styles + scrollY captured on the FIRST modal
// open. Subsequent modals stack without re-capturing — fixes the
// StrictMode-double-invoke / rapid-toggle bug where the second effect would
// capture the already-locked styles and "restore" them to fixed-position
// forever, leaving the body stuck on close.
const lockState: {
  count: number;
  scrollY: number;
  prev: { position: string; top: string; width: string } | null;
} = { count: 0, scrollY: 0, prev: null };

function acquireScrollLock() {
  if (lockState.count === 0) {
    lockState.scrollY = window.scrollY;
    lockState.prev = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockState.scrollY}px`;
    document.body.style.width = '100%';
  }
  lockState.count += 1;
}

function releaseScrollLock() {
  lockState.count = Math.max(0, lockState.count - 1);
  if (lockState.count === 0 && lockState.prev) {
    document.body.style.position = lockState.prev.position;
    document.body.style.top = lockState.prev.top;
    document.body.style.width = lockState.prev.width;
    window.scrollTo(0, lockState.scrollY);
    lockState.prev = null;
  }
}

export function useModalA11y({ isOpen, onClose, ref }: UseModalA11yOptions) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Body scroll lock + capture previously-focused element
  useEffect(() => {
    if (!isOpen) return;
    // Remember focus to restore on close. Captured PER hook instance so each
    // modal restores to its own opener — even when modals stack.
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    acquireScrollLock();

    return () => {
      releaseScrollLock();
      // Restore focus only if the previously-focused element is still in the DOM —
      // otherwise focus() throws or silently focuses the body, breaking keyboard
      // flow for the next modal.
      const prev = previouslyFocusedRef.current;
      if (prev && prev.isConnected) {
        prev.focus?.();
      }
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
