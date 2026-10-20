'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TOAST_DISMISS_EVENT,
  TOAST_EVENT,
  type Toast,
  type ToastDismissEventDetail,
  type ToastEventDetail,
  type ToastVariant,
} from '@/lib/toast';

/** Maximum number of toasts visible at once. Older toasts are evicted FIFO,
 *  sticky ones (no auto-dismiss, or an action button) last. */
const MAX_VISIBLE = 3;

/** Duration (ms) of the slide-in / slide-out transition. */
const ANIMATION_MS = 200;

/** Tailwind classes per variant. */
const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default: 'bg-stone-800 text-white',
  success: 'bg-teal-600 text-white',
  error: 'bg-rose-600 text-white',
  info: 'bg-blue-600 text-white',
};

/**
 * Read `prefers-reduced-motion: reduce` once, safely on the client. Used as
 * a lazy initial state value so we can keep the effect that subscribes to
 * media-query changes free of a setState-in-effect call (which the
 * react-hooks/set-state-in-effect lint rule flags).
 */
function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface ToastCardProps {
  toast: Toast;
  onDismiss: (id: string) => void;
  reducedMotion: boolean;
}

/**
 * A single toast card. Owns its own enter/exit transition state. The parent
 * decides when to mount (enter) and unmount (after exit completes) by way of
 * `onDismiss` — when the user clicks ✕ or an action, we flip to `leaving`,
 * wait `ANIMATION_MS`, then notify the parent which removes us from state.
 */
function ToastCard({ toast, onDismiss, reducedMotion }: ToastCardProps) {
  // `entered` flips from false → true on the next frame after mount so the
  // CSS transition runs from the initial (off-screen, transparent) state to
  // the visible state. With reduced motion we start at `entered = true`.
  const [entered, setEntered] = useState(reducedMotion);
  const [leaving, setLeaving] = useState(false);
  const leaveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) return;
    // Schedule the transition to begin on the next animation frame.
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  // If the parent decides to remove this toast (e.g. auto-dismiss timeout
  // fired, or eviction due to MAX_VISIBLE), the component unmounts directly.
  // For user-initiated dismissal we play the leave transition first.
  const handleClose = useCallback(() => {
    if (leaving) return;
    if (reducedMotion) {
      onDismiss(toast.id);
      return;
    }
    setLeaving(true);
    leaveTimeoutRef.current = window.setTimeout(() => {
      onDismiss(toast.id);
    }, ANIMATION_MS);
  }, [leaving, onDismiss, reducedMotion, toast.id]);

  useEffect(() => {
    return () => {
      if (leaveTimeoutRef.current !== null) {
        clearTimeout(leaveTimeoutRef.current);
      }
    };
  }, []);

  const handleAction = useCallback(() => {
    if (toast.action) {
      try {
        toast.action.onClick();
      } catch (err) {
        // Don't let a misbehaving handler block dismissal.
        console.error('[Toast] action handler threw:', err);
      }
    }
    handleClose();
  }, [toast.action, handleClose]);

  // Build the transition class. `reducedMotion` users get no transform/opacity
  // transition at all — the card just appears.
  const transitionClasses = reducedMotion
    ? ''
    : 'transition-all duration-200 ease-out';

  const visible = entered && !leaving;
  const stateClasses = visible
    ? 'translate-y-0 opacity-100'
    : '-translate-y-4 opacity-0';

  return (
    // Announced through ToastProvider's persistent live regions, not here: a
    // live region inserted together with its text is usually not read.
    <div
      className={[
        'pointer-events-auto w-full max-w-sm mx-auto',
        'rounded-xl shadow-lg',
        'px-4 py-3 pr-10',
        'flex items-start gap-3',
        'relative',
        VARIANT_CLASSES[toast.variant],
        transitionClasses,
        reducedMotion ? '' : stateClasses,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex-1 min-w-0 text-sm leading-snug break-words">
        {toast.message}
      </div>

      {toast.action ? (
        <button
          type="button"
          onClick={handleAction}
          className="shrink-0 text-sm font-medium underline underline-offset-2 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded"
        >
          {toast.action.label}
        </button>
      ) : null}

      <button
        type="button"
        onClick={handleClose}
        aria-label="Dismiss notification"
        // Audit fix: bump 7×7 (28px) → 11×11 (44px) to meet WCAG / iOS touch
        // target minimums. Padding around a smaller × glyph keeps the visual
        // weight unchanged while giving the user a real hit area.
        className="absolute top-0.5 right-0.5 w-11 h-11 inline-flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 transition-colors"
      >
        {/* Plain × glyph — no emoji, scales with the font */}
        <span aria-hidden="true" className="text-base leading-none">
          &times;
        </span>
      </button>
    </div>
  );
}

/**
 * Listens for `jaisus-toast` / `jaisus-toast-dismiss` window events and
 * renders the visible toast stack at the top of the viewport.
 *
 * Place once near the root of the app (e.g. in `layout.tsx`). Anywhere in the
 * codebase you can then `import { toast } from '@/lib/toast'` and fire toasts
 * without React context.
 *
 * Behaviour:
 *   - Caps visible toasts at MAX_VISIBLE (3). Excess toasts evict the oldest
 *     auto-dismissing one; sticky toasts (duration 0 or an action) go last.
 *   - Each toast auto-dismisses after `duration` ms (0 disables auto-dismiss).
 *   - Per-toast timers are tracked and cleared on dismiss/unmount.
 *   - With no toasts, renders only two empty, visually hidden live regions.
 */
export function ToastProvider() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Lazy initializer — must read media query at mount (client only) without
  // a follow-up setState inside an effect.
  const [reducedMotion, setReducedMotion] = useState<boolean>(readReducedMotion);

  // Track auto-dismiss timeouts per toast id so we can clear them on manual
  // dismiss / unmount. We use a ref so React state updates don't churn them.
  const timeoutsRef = useRef<Map<string, number>>(new Map());

  // Wrap dismissal so it both removes the toast and clears its pending timer.
  const removeToast = useCallback((id: string) => {
    const handle = timeoutsRef.current.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timeoutsRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Subscribe to the reduced-motion media query so toggling the OS setting
  // mid-session takes effect. The initial value is seeded by the lazy
  // initializer above — this effect only wires up the change listener.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    // Safari < 14 only supports addListener; modern browsers prefer addEventListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);

  // Main subscription to the imperative API's window events.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastEventDetail>).detail;
      if (!detail || !detail.toast) return;
      const incoming = detail.toast;

      setToasts((prev) => {
        // Eviction: drop the oldest until there's room. Sticky toasts (e.g.
        // VersionCheck's "new version — Refresh", shown only once) go last.
        let trimmed = prev;
        while (trimmed.length >= MAX_VISIBLE) {
          const oldestFleeting = trimmed.findIndex((t) => t.duration > 0 && !t.action);
          const evict = oldestFleeting >= 0 ? oldestFleeting : 0;
          trimmed = trimmed.filter((_, i) => i !== evict);
        }

        // Clear timers for any toasts we just evicted.
        const kept = new Set(trimmed.map((t) => t.id));
        for (const old of prev) {
          if (!kept.has(old.id)) {
            const handle = timeoutsRef.current.get(old.id);
            if (handle !== undefined) {
              clearTimeout(handle);
              timeoutsRef.current.delete(old.id);
            }
          }
        }

        return [...trimmed, incoming];
      });

      // Schedule auto-dismiss if duration > 0.
      if (incoming.duration > 0) {
        const handle = window.setTimeout(() => {
          removeToast(incoming.id);
        }, incoming.duration);
        timeoutsRef.current.set(incoming.id, handle);
      }
    }

    function onDismiss(e: Event) {
      const detail = (e as CustomEvent<ToastDismissEventDetail>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      removeToast(detail.id);
    }

    window.addEventListener(TOAST_EVENT, onToast);
    window.addEventListener(TOAST_DISMISS_EVENT, onDismiss);

    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      window.removeEventListener(TOAST_DISMISS_EVENT, onDismiss);
    };
  }, [removeToast]);

  // Clear every pending timeout on unmount so nothing fires into a dead tree.
  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const handle of timeouts.values()) {
        clearTimeout(handle);
      }
      timeouts.clear();
    };
  }, []);

  // ARIA: errors are assertive alerts; everything else is a polite status.
  // These regions are always rendered (also with no toasts) and stay at the
  // same place in the tree, so screen readers are already watching them when
  // a toast's text is added. aria-atomic="false": these roles default to
  // atomic, which re-read every toast still on screen (e.g. a sticky "new
  // version" toast) before each new one.
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="false" aria-relevant="additions">
        {toasts
          .filter((t) => t.variant !== 'error')
          .map((t) => (
            <p key={t.id}>{t.message}</p>
          ))}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="false" aria-relevant="additions">
        {toasts
          .filter((t) => t.variant === 'error')
          .map((t) => (
            <p key={t.id}>{t.message}</p>
          ))}
      </div>
      {toasts.length > 0 && (
        <div
          // Fixed top-center stack. `pointer-events-none` so the wrapper never
          // blocks underlying UI; individual cards re-enable pointer events.
          // Audit fix: add safe-area-inset-top so toasts don't sit under the
          // notch / status bar when running as a PWA on notched iPhones.
          className="fixed inset-x-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none"
          // Full-screen views with their own top bar (ParableReader) set
          // --toast-top-offset so toasts sit below their controls.
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + var(--toast-top-offset, 1rem))' }}
          aria-label="Notifications"
        >
          {toasts.map((t) => (
            <ToastCard
              key={t.id}
              toast={t}
              onDismiss={removeToast}
              reducedMotion={reducedMotion}
            />
          ))}
        </div>
      )}
    </>
  );
}
