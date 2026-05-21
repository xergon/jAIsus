/**
 * Imperative toast API for jAIsus.
 *
 * Decoupled from React: any code (libs, hooks, event handlers, async callbacks)
 * can call `toast.success('Saved!')` without going through a context provider.
 * Communication happens via two `CustomEvent`s on `window`:
 *
 *   - `'jaisus-toast'`         → payload is the new `Toast` object
 *   - `'jaisus-toast-dismiss'` → payload is `{ id: string }`
 *
 * `<ToastProvider />` (in `src/components/Toast.tsx`) is the sole listener and
 * owns rendering + auto-dismiss timers. If no provider is mounted, calls are
 * still safe — events simply have no subscriber.
 *
 * Usage:
 *   import { toast } from '@/lib/toast';
 *   toast.success('Saved!');
 *   toast('Hello', { variant: 'info', duration: 2000 });
 *   const id = toast.error('Network failed', { duration: 0 });
 *   toast.dismiss(id);
 */

export type ToastVariant = 'default' | 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Auto-dismiss after this many ms. Default 4000. Set 0 to disable auto-dismiss. */
  duration?: number;
  /** Optional action button shown inside the toast. */
  action?: ToastAction;
}

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  action?: ToastAction;
  createdAt: number;
}

/** Event payload contracts. Exported so the provider can type its listeners. */
export const TOAST_EVENT = 'jaisus-toast' as const;
export const TOAST_DISMISS_EVENT = 'jaisus-toast-dismiss' as const;

export interface ToastEventDetail {
  toast: Toast;
}

export interface ToastDismissEventDetail {
  id: string;
}

const DEFAULT_DURATION = 4000;

/**
 * Generate a unique id for a toast.
 * Prefers `crypto.randomUUID` (modern browsers, Node 19+); falls back to a
 * Math.random-based string for older runtimes / SSR safety.
 */
function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Internal: dispatch a toast event. Safe to call during SSR (no-op without window).
 */
function dispatchToast(message: string, options?: ToastOptions & { variant?: ToastVariant }): string {
  const id = makeId();

  if (typeof window === 'undefined') {
    // SSR / Node — no DOM to dispatch into. Still return an id so callers can
    // hold a reference; the no-op is intentional and matches client behaviour
    // when no provider is mounted.
    return id;
  }

  const toastObj: Toast = {
    id,
    message,
    variant: options?.variant ?? 'default',
    duration: options?.duration ?? DEFAULT_DURATION,
    action: options?.action,
    createdAt: Date.now(),
  };

  const event = new CustomEvent<ToastEventDetail>(TOAST_EVENT, {
    detail: { toast: toastObj },
  });
  window.dispatchEvent(event);

  return id;
}

/**
 * Internal: dispatch a dismiss event. Safe during SSR (no-op without window).
 */
function dispatchDismiss(id: string): void {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent<ToastDismissEventDetail>(TOAST_DISMISS_EVENT, {
    detail: { id },
  });
  window.dispatchEvent(event);
}

/**
 * Callable toast API. Use as a function for arbitrary variants:
 *   toast('Hello', { variant: 'info' })
 *
 * Or use the attached helpers for ergonomics:
 *   toast.success('Saved!')
 *   toast.error('Failed', { duration: 0 })
 *   toast.dismiss(id)
 *
 * Returns the toast id, which can be passed to `toast.dismiss()` later.
 */
interface ToastFn {
  (message: string, options?: ToastOptions & { variant?: ToastVariant }): string;
  default: (message: string, options?: ToastOptions) => string;
  success: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  info: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const toastFn: ToastFn = ((message: string, options?: ToastOptions & { variant?: ToastVariant }) =>
  dispatchToast(message, options)) as ToastFn;

toastFn.default = (message, options) => dispatchToast(message, { ...options, variant: 'default' });
toastFn.success = (message, options) => dispatchToast(message, { ...options, variant: 'success' });
toastFn.error = (message, options) => dispatchToast(message, { ...options, variant: 'error' });
toastFn.info = (message, options) => dispatchToast(message, { ...options, variant: 'info' });
toastFn.dismiss = (id) => dispatchDismiss(id);

export const toast = toastFn;
