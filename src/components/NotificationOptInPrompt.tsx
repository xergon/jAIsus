'use client';

import { useEffect, useRef, useState } from 'react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import { toast } from '@/lib/toast';

/**
 * One-time consent prompt for daily-verse push notifications.
 *
 * Notification permission is sticky and slightly intrusive, so we ask exactly
 * once: the choice persists to localStorage and we never re-prompt — even if
 * the user declined. This component handles the persistence; the parent
 * decides when to mount it (probably after a few uses, on a returning visit).
 *
 * Reuses `useModalA11y` for scroll lock, focus trap, Escape-to-close, and
 * focus restore — matching VADConsentPrompt and the other modals.
 */

const STORAGE_KEY = 'jaisus-notification-prompt-seen';

/** True if the user has already been shown the prompt (accepted or declined). */
export function hasSeenNotificationPrompt(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private mode / storage disabled — fail closed (we'll show the prompt
    // again next session, but that's the lesser evil vs. spamming it now).
    return false;
  }
}

/** Record that the prompt has been shown. Idempotent. */
export function markNotificationPromptSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Best effort — see hasSeenNotificationPrompt comment.
  }
}

/** Why turning on daily verses failed, or null when the user closed the browser's dialog. */
function subscribeFailureMessage(error?: string): string | null {
  if (error === 'Permission default') return null;
  if (error === 'Permission denied') {
    return 'Notifications are blocked for this site. You can allow them in your browser settings.';
  }
  if (error?.startsWith('Push not supported')) {
    return "This browser can't receive daily verses. On iPhone, add jAIsus to your Home Screen first.";
  }
  return "Couldn't turn on daily verses right now.";
}

interface NotificationOptInPromptProps {
  isOpen: boolean;
  /** Called after the user accepts AND the subscription succeeds. */
  onAccepted?: () => void;
  /** Called when the user dismisses (declined or closed). */
  onDeclined: () => void;
}

export function NotificationOptInPrompt({
  isOpen,
  onAccepted,
  onDeclined,
}: NotificationOptInPromptProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { subscribe } = usePushSubscription();
  // Waiting for the browser's permission dialog and the subscription.
  const [busy, setBusy] = useState(false);
  // Audit fix: track mount so handleAccept's awaited subscribe() can't fire
  // callbacks on a stale parent (e.g. modal closed while the browser's
  // permission prompt is still pending).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useModalA11y({
    isOpen,
    onClose: () => {
      markNotificationPromptSeen();
      onDeclined();
    },
    ref: dialogRef,
  });

  if (!isOpen) return null;

  const handleDecline = () => {
    markNotificationPromptSeen();
    onDeclined();
  };

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    markNotificationPromptSeen();
    const result = await subscribe();
    if (!mountedRef.current) return;
    setBusy(false);
    if (result.ok) {
      onAccepted?.();
    } else {
      // Permission denied / unsupported / network — close anyway. We
      // already marked seen so we won't re-prompt; user can re-enable from
      // Settings later (a future addition). Say why, unless the user just
      // closed the browser's own permission dialog.
      const reason = subscribeFailureMessage(result.error);
      if (reason) toast.error(reason);
      onDeclined();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={handleDecline}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-title"
        aria-describedby="notif-body"
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl py-6 px-5"
      >
        <div className="flex justify-center mb-3">
          <div
            className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center text-2xl"
            aria-hidden="true"
          >
            🕊
          </div>
        </div>

        <h2
          id="notif-title"
          className="text-center text-lg font-bold text-stone-800"
        >
          Want a daily verse?
        </h2>

        <p
          id="notif-body"
          className="text-center text-sm text-stone-600 mt-3 leading-relaxed"
        >
          We&apos;ll send you one verse a day — that&apos;s it. No promotions,
          no nudges to come back. Tap a notification to open jAIsus.
        </p>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={handleDecline}
            className="flex-1 rounded-xl border border-stone-200 bg-stone-50 py-2.5 text-sm font-medium text-stone-600
              active:scale-[0.98] transition-transform"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={busy}
            aria-busy={busy}
            className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white shadow-sm
              hover:bg-teal-700 active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {busy ? 'Turning on…' : 'Yes, daily verse'}
          </button>
        </div>
      </div>
    </div>
  );
}
