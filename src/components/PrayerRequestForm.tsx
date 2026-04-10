'use client';

import { useState } from 'react';

interface PrayerRequestFormProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PrayerRequestForm({ isOpen, onClose }: PrayerRequestFormProps) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit() {
    if (!text.trim()) return;

    const prayers = JSON.parse(localStorage.getItem('jaisus-prayers') || '[]');
    prayers.push({ id: Date.now().toString(), text: text.trim(), timestamp: Date.now() });
    localStorage.setItem('jaisus-prayers', JSON.stringify(prayers));

    setSubmitted(true);
    setText('');
    setTimeout(() => {
      setSubmitted(false);
      onClose();
    }, 2500);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl shadow-2xl p-5 animate-slide-up">
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full bg-stone-300" />
        </div>

        {submitted ? (
          <div className="text-center py-8 animate-fade-in">
            <div className="text-5xl mb-3">🙏</div>
            <h3 className="text-lg font-bold text-stone-800">Your Prayer Has Been Received</h3>
            <p className="text-sm text-stone-500 mt-2">
              May you find peace and comfort in this moment.
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold text-stone-800 text-center">Request Prayer</h2>
            <p className="text-sm text-stone-500 text-center mt-1">
              Share what&apos;s on your heart
            </p>

            <textarea
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
