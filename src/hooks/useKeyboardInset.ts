'use client';

import { useEffect, useState } from 'react';

export interface KeyboardInset {
  /** px of the layout viewport hidden below the visible area (the on-screen keyboard). 0 when it's closed. */
  inset: number;
  /** Tallest a bottom sheet can be and still fit above the keyboard. undefined when it's closed. */
  maxHeight: number | undefined;
}

const CLOSED: KeyboardInset = { inset: 0, maxHeight: undefined };

// Below this the visual viewport shrank for something other than a keyboard
// (e.g. the iOS shortcut bar with a hardware keyboard).
const MIN_KEYBOARD_PX = 80;

/**
 * Bottom sheets sit at the bottom of a `fixed inset-0` layer, which follows
 * the layout viewport. On iOS Safari and Android Chrome 108+ the on-screen
 * keyboard only shrinks the visual viewport, so a sheet's fields and buttons
 * end up under it. While `active`, this returns how far to lift the sheet
 * (`inset`) and how tall it may be (`maxHeight`) to stay above the keyboard.
 */
export function useKeyboardInset(active: boolean): KeyboardInset {
  const [state, setState] = useState<KeyboardInset>(CLOSED);

  // Drop the last reading when the sheet closes so the next open doesn't
  // start lifted.
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (!active) setState(CLOSED);
  }

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // Pinch-zoom shrinks vv.height too; undoing the zoom leaves only the keyboard.
      const keyboard = window.innerHeight - vv.height * vv.scale;
      if (keyboard < MIN_KEYBOARD_PX) {
        setState(CLOSED);
        return;
      }
      // offsetTop: the browser may also pan the visual viewport up to reveal the
      // focused field, so lift only by what's still hidden below it.
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const maxHeight = Math.round(vv.height * 0.9);
      setState((prev) =>
        prev.inset === inset && prev.maxHeight === maxHeight ? prev : { inset, maxHeight }
      );
    };

    const raf = requestAnimationFrame(update);
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);

  return active ? state : CLOSED;
}
