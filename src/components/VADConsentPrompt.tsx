'use client';

import { useRef } from 'react';
import { useModalA11y } from '@/hooks/useModalA11y';

/**
 * One-time consent prompt for voice activity detection (VAD).
 *
 * Mic access is sensitive, so we ask explicitly the first time the feature
 * becomes relevant (i.e., the user is in a TTS context). The choice persists
 * to localStorage so we don't re-ask on every session. Default state is null
 * (not asked) — the parent decides when to mount this.
 */

const STORAGE_KEY = 'jaisus-vad-consent';

export type VADConsent = 'accepted' | 'declined';

/** Read the persisted consent decision. Returns null if never asked. */
export function getVADConsent(): VADConsent | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'accepted' || v === 'declined' ? v : null;
  } catch {
    return null;
  }
}

/** Persist the user's consent decision. */
export function setVADConsent(v: VADConsent): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // Storage may be disabled in private mode — caller can still proceed
    // for the current session; we just can't remember next time.
  }
}

interface VADConsentPromptProps {
  /** Render-when condition: the parent only mounts this when relevant. */
  isOpen: boolean;
  onAccept: () => void;
  onDecline: () => void;
  /** Backdrop or Escape: close without saving a choice. Defaults to onDecline. */
  onDismiss?: () => void;
}

export function VADConsentPrompt({ isOpen, onAccept, onDecline, onDismiss }: VADConsentPromptProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dismiss = onDismiss ?? onDecline;
  useModalA11y({ isOpen, onClose: dismiss, ref: dialogRef });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={dismiss}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vad-title"
        aria-describedby="vad-body"
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl py-6 px-5"
      >
        <div className="flex justify-center mb-3">
          <div
            className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center text-2xl"
            aria-hidden="true"
          >
            🎤
          </div>
        </div>

        <h2
          id="vad-title"
          className="text-center text-lg font-bold text-stone-800"
        >
          Let me hear you?
        </h2>

        <p
          id="vad-body"
          className="text-center text-sm text-stone-600 mt-3 leading-relaxed"
        >
          When jAIsus is speaking, I can listen for you to interrupt naturally —
          no need to tap a button. Mic access stays in your browser and is only
          used while he&apos;s talking back. You can turn this off anytime in
          Settings.
        </p>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onDecline}
            className="flex-1 rounded-xl border border-stone-200 bg-stone-50 py-2.5 text-sm font-medium text-stone-600
              active:scale-[0.98] transition-transform"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white shadow-sm
              hover:bg-teal-700 active:scale-[0.98] transition-transform"
          >
            Yes, listen
          </button>
        </div>
      </div>
    </div>
  );
}
