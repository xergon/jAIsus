'use client';

import { useState, useRef, useEffect } from 'react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { toast } from '@/lib/toast';
import { track } from '@/lib/analytics';

interface PrayerRequestFormProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PrayerRequestForm({ isOpen, onClose }: PrayerRequestFormProps) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useModalA11y({ isOpen, onClose, ref: dialogRef });
  const keyboard = useKeyboardInset(isOpen);

  // Cleanup the close-timeout on unmount or if the modal closes early
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  // Reset submitted state when modal is closed and reopened. Adjusted during
  // render (React's "store info from previous renders" pattern); the pending
  // close timer is cleared in the effect below.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (!isOpen) setSubmitted(false);
  }
  useEffect(() => {
    if (isOpen) return;
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, [isOpen]);

  function handleSubmit() {
    if (!text.trim()) return;

    let storageFailed = false;
    try {
      // Validate the stored payload before mutating — older/poisoned data
      // (non-array) would otherwise crash .push() and silently lose this prayer.
      let prayers: Array<{ id: string; text: string; timestamp: number }> = [];
      try {
        const raw = JSON.parse(localStorage.getItem('jaisus-prayers') || '[]');
        if (Array.isArray(raw)) prayers = raw;
      } catch {
        // Stored data was malformed JSON. Start fresh; the user's intent is
        // still honored and the bad entry gets overwritten by the next setItem.
      }
      prayers.push({ id: Date.now().toString(), text: text.trim(), timestamp: Date.now() });
      localStorage.setItem('jaisus-prayers', JSON.stringify(prayers));
    } catch (err) {
      console.warn('Failed to persist prayer:', err);
      storageFailed = true;
      // Still show success — the request was received emotionally even if storage failed
    }

    setSubmitted(true);
    setText('');

    // Privacy: no content tracked, only the fact of submission.
    track('prayer.submitted');

    if (storageFailed) {
      // Soft error — user still sees the success UI; this just acknowledges the storage issue.
      toast.error('Could not save your prayer — but your intent is heard.');
    } else {
      // Supplements the in-modal confirmation (which auto-dismisses after 2.5s).
      toast.success('Your prayer has been received');
    }

    closeTimeoutRef.current = setTimeout(() => {
      setSubmitted(false);
      onClose();
      closeTimeoutRef.current = null;
    }, 2500);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prayer-title"
        className="relative w-full max-w-md bg-white rounded-t-2xl shadow-2xl p-5 animate-slide-up"
        style={keyboard.maxHeight ? { marginBottom: keyboard.inset, maxHeight: keyboard.maxHeight, overflowY: 'auto' } : undefined}
      >
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full bg-stone-300" aria-hidden="true" />
        </div>

        {submitted ? (
          <div className="text-center py-8 animate-fade-in" role="status">
            <div className="text-5xl mb-3" aria-hidden="true">🙏</div>
            <h3 id="prayer-title" className="text-lg font-bold text-stone-800">Your Prayer Has Been Received</h3>
            <p className="text-sm text-stone-500 mt-2">
              May you find peace and comfort in this moment.
            </p>
          </div>
        ) : (
          <>
            <h2 id="prayer-title" className="text-lg font-bold text-stone-800 text-center">Request Prayer</h2>
            <p className="text-sm text-stone-500 text-center mt-1">
              Share what&apos;s on your heart
            </p>

            <label htmlFor="prayer-text" className="sr-only">Your prayer request</label>
            <textarea
              id="prayer-text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Write your prayer request here..."
              rows={4}
              className="mt-4 w-full rounded-xl border border-stone-200 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400"
            />

            <div className="flex gap-3 mt-4">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm font-medium text-stone-600 active:scale-[0.98] transition-transform"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!text.trim()}
                className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white
                  disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                Submit Prayer
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
