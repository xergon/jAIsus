'use client';

import { useRef, useState, useEffect } from 'react';
import type { JSX, TouchEvent } from 'react';
import { useModalA11y } from '@/hooks/useModalA11y';

interface OnboardingOverlayProps {
  /** Controlled. Parent decides when to show. */
  isOpen: boolean;
  /** Called when user finishes or dismisses. Parent should call markOnboardingSeen() in this handler. */
  onComplete: () => void;
}

/**
 * Each slide's content lives in this small declarative array. Keeps the
 * render loop straightforward and the copy easy to scan in one place.
 */
interface Slide {
  title: string;
  subtitle: string;
  /** Optional ribbon below the subtitle — used for the disclaimer on slide 1. */
  note?: string;
  /** Optional visual under the text. */
  visual?: 'mic' | 'chips';
}

const SLIDES: ReadonlyArray<Slide> = [
  {
    title: 'Meet jAIsus',
    subtitle:
      'An AI guide grounded in the teachings of Jesus — and his many possible voices.',
    note: 'Not a replacement for spiritual community or professional support.',
  },
  {
    title: 'Tap the mic, ask anything',
    subtitle:
      'Or type. He listens, then speaks back. Try a question about life, faith, or a parable.',
    visual: 'mic',
  },
  {
    title: 'He has many voices',
    subtitle:
      'From the Gentle Shepherd to a stand-up comedian. Change personalities anytime in Settings.',
    visual: 'chips',
  },
  {
    title: 'Begin',
    subtitle:
      "Be kind to yourself. He's just an AI — but he might say something useful anyway.",
  },
];

/** Pixels of horizontal swipe required to commit to a slide change. */
const SWIPE_THRESHOLD = 50;

/**
 * Local <style> tag so we don't have to edit globals.css. The keyframes
 * are scoped by a data attribute on each slide. `prefers-reduced-motion`
 * disables the transform/opacity transition entirely (a hard requirement
 * per the spec).
 */
const SLIDE_KEYFRAMES = `@keyframes jaisusOnboardingSlideIn {
  from { opacity: 0; transform: translateX(12px); }
  to   { opacity: 1; transform: translateX(0); }
}
[data-jaisus-onboarding-slide] {
  animation: jaisusOnboardingSlideIn 0.28s cubic-bezier(0.32, 0.72, 0, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  [data-jaisus-onboarding-slide] { animation: none !important; }
}`;

export function OnboardingOverlay({
  isOpen,
  onComplete,
}: OnboardingOverlayProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const touchStartXRef = useRef<number | null>(null);

  useModalA11y({ isOpen, onClose: onComplete, ref: dialogRef });

  // When the overlay is re-opened (e.g. via a debug reset), restart at slide 0.
  useEffect(() => {
    if (isOpen) setIndex(0);
  }, [isOpen]);

  if (!isOpen) return null;

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  function goNext() {
    if (isLast) {
      onComplete();
      return;
    }
    setIndex(i => Math.min(i + 1, SLIDES.length - 1));
  }

  function goPrev() {
    setIndex(i => Math.max(i - 1, 0));
  }

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (startX === null) return;
    const endX = e.changedTouches[0]?.clientX;
    if (endX === undefined) return;
    const delta = endX - startX;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    // Swipe left (delta < 0) → next; swipe right (delta > 0) → prev.
    if (delta < 0) goNext();
    else goPrev();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-fade-in"
      // Tap outside the card to dismiss — matches user expectations for a modal.
      // Audit fix: only dismiss when the tap actually lands on the BACKDROP
      // itself (not a child). Previously a swipe that ended outside the card
      // could bubble a click here and prematurely close the whole onboarding.
      onClick={(e) => {
        if (e.target === e.currentTarget) onComplete();
      }}
    >
      <style>{SLIDE_KEYFRAMES}</style>

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="relative w-[calc(100%-2rem)] max-w-sm bg-white rounded-3xl p-8 shadow-2xl ring-2 ring-amber-300/30"
        // Stop propagation so taps inside the card don't dismiss.
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Skip link — small, top-right, always available */}
        <button
          type="button"
          onClick={onComplete}
          className="absolute top-3 right-4 text-xs font-medium text-stone-500 hover:text-stone-700 active:scale-[0.98] transition-all"
        >
          Skip
        </button>

        {/* Slide body. `key` forces a remount on index change so the keyframe
            animation re-runs. */}
        <div key={index} data-jaisus-onboarding-slide className="pt-4 pb-2">
          <h2
            id="onboarding-title"
            className="text-2xl font-bold text-stone-800 text-center"
          >
            {slide.title}
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-stone-600 text-center">
            {slide.subtitle}
          </p>

          {slide.note && (
            <p className="mt-3 text-xs text-stone-500 italic text-center">
              {slide.note}
            </p>
          )}

          {slide.visual === 'mic' && (
            <div className="mt-6 flex justify-center" aria-hidden="true">
              {/* Visual mock of the teal mic — matches VoiceButton's idle state. */}
              <div className="relative flex items-center justify-center w-14 h-14 rounded-full bg-teal-500 text-white shadow-lg shadow-teal-200">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="1" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                </svg>
              </div>
            </div>
          )}

          {slide.visual === 'chips' && (
            <div
              className="mt-6 flex justify-center gap-2"
              aria-hidden="true"
            >
              {['🐑', '🍄', '🏄', '⚡'].map(emoji => (
                <span
                  key={emoji}
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-50 ring-1 ring-amber-200 text-lg"
                >
                  {emoji}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Page indicators */}
        <div
          className="mt-6 flex items-center justify-center gap-2"
          role="tablist"
          aria-label="Onboarding progress"
        >
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Go to slide ${i + 1} of ${SLIDES.length}`}
              onClick={() => setIndex(i)}
              className={`h-2 rounded-full transition-all ${
                i === index ? 'w-6 bg-teal-500' : 'w-2 bg-stone-300'
              }`}
            />
          ))}
        </div>

        {/* Primary CTA */}
        <button
          type="button"
          onClick={goNext}
          className="mt-6 w-full rounded-xl bg-teal-500 py-3 text-sm font-semibold text-white shadow-md shadow-teal-200 active:scale-[0.98] transition-transform hover:bg-teal-600"
        >
          {isLast ? 'Start talking' : 'Next'}
        </button>
      </div>
    </div>
  );
}
