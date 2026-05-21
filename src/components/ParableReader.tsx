'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Parable } from '@/lib/types';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { FavoriteButton } from '@/components/FavoriteButton';
import { ShareButton } from '@/components/ShareButton';
import { track } from '@/lib/analytics';

interface ParableReaderProps {
  /** Pass null to close. */
  parable: Parable | null;
  onClose: () => void;
  /** Optional: dispatch a message about this parable to chat. Closes on use. */
  onAskAbout?: (prompt: string) => void;
}

const ENTER_MS = 250;

/**
 * Read `prefers-reduced-motion: reduce` once on the client.
 * Falls back to false during SSR — we always animate by default, and the
 * client checks override on mount.
 */
function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Immersive, full-screen reading mode for a single parable.
 *
 * Unlike `ParablesDrawer` (a bottom sheet for browsing the index), this is the
 * "library chair" surface: warm cream background, generous serif typography,
 * a drop-cap, and minimal chrome so the text breathes. Only renders when a
 * parable is provided — pass `null` to close.
 *
 * Animation: slides in from the right on open, slides out on close. With
 * `prefers-reduced-motion: reduce`, both transitions are instant.
 *
 * A11y: full modal plumbing via `useModalA11y` — body-scroll lock, focus
 * trap, Escape-to-close, and focus restoration when the reader closes.
 */
export function ParableReader({
  parable,
  onClose,
  onAskAbout,
}: ParableReaderProps): JSX.Element | null {
  const isOpen = parable !== null;
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });

  const { speak, stop, isSpeaking } = useSpeechSynthesis();

  // Reduced motion is read once on mount. We don't subscribe to live changes
  // — toggling the OS pref mid-read is an extreme edge case, and the reader
  // is short-lived.
  const [reducedMotion] = useState<boolean>(readReducedMotion);

  // `entered` controls the slide transform. Starts false on every new parable
  // and flips to true on the next animation frame so the CSS transition runs.
  // With reduced motion we skip the transition entirely (start at true).
  const [entered, setEntered] = useState<boolean>(reducedMotion);

  // Track the parable that's currently being shown so we know when it changes
  // (and can stop any in-flight TTS). Using the id is enough — referential
  // equality on the object isn't guaranteed across re-renders.
  const currentIdRef = useRef<string | null>(null);

  // --- mount/unmount + slide-in animation ---
  useEffect(() => {
    if (!parable) {
      // Reset to off-screen state so the next open animates in cleanly.
      setEntered(reducedMotion);
      return;
    }
    if (reducedMotion) {
      setEntered(true);
      return;
    }
    // Start off-screen, then on the next frame flip to entered.
    setEntered(false);
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [parable, reducedMotion]);

  // --- analytics: opened / closed ---
  useEffect(() => {
    if (!parable) return;
    // New parable opened (or the panel was just shown).
    track('parable.opened', { id: parable.id });
    currentIdRef.current = parable.id;
    return () => {
      // The parable changed or the component unmounted — fire closed for the
      // id we were showing. We capture from the ref to avoid the stale-closure
      // problem if `parable` flipped mid-effect.
      const closingId = currentIdRef.current;
      if (closingId) {
        track('parable.closed', { id: closingId });
        currentIdRef.current = null;
      }
    };
  }, [parable]);

  // --- TTS: stop when parable changes or unmounts ---
  // The hook itself stops on unmount, but we also stop when SWITCHING parables
  // without unmounting (rare, but possible if the parent re-points the prop).
  useEffect(() => {
    return () => {
      stop();
    };
  }, [parable, stop]);

  // --- listen button handler ---
  const handleListen = useCallback(() => {
    if (!parable) return;
    if (isSpeaking) {
      stop();
      return;
    }
    speak(`${parable.title}. ${parable.fullText}`);
    track('parable.listen', { id: parable.id });
  }, [parable, isSpeaking, speak, stop]);

  // --- ask-about CTA ---
  const handleAskAbout = useCallback(() => {
    if (!parable || !onAskAbout) return;
    onAskAbout(parable.suggestPrompt);
    onClose();
  }, [parable, onAskAbout, onClose]);

  // When parable is null, render nothing — the consumer is in control.
  if (!parable) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="parable-reader-title"
      className={[
        'fixed inset-0 z-50 bg-stone-50 overflow-hidden',
        'transition-transform ease-out',
        reducedMotion ? 'duration-0' : 'duration-[250ms]',
        entered ? 'translate-x-0' : 'translate-x-full',
        'motion-reduce:transition-none motion-reduce:duration-0',
      ].join(' ')}
      // Hint to the browser that we're animating transform.
      style={{ willChange: reducedMotion ? undefined : 'transform' }}
    >
      {/* Top bar — sticky chrome with back, listen, favorite, share. */}
      <div className="sticky top-0 z-10 h-14 flex items-center justify-between px-3 bg-stone-50/95 backdrop-blur-sm border-b border-stone-200">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close reader"
          title="Close reader"
          className="w-11 h-11 inline-flex items-center justify-center rounded-full text-stone-700 hover:bg-stone-200/60 active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={22}
            height={22}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleListen}
            aria-label={isSpeaking ? 'Stop listening' : 'Listen to this parable'}
            aria-pressed={isSpeaking}
            title={isSpeaking ? 'Stop listening' : 'Listen to this parable'}
            className={[
              'w-9 h-9 inline-flex items-center justify-center rounded-full',
              'transition-transform duration-150 ease-out active:scale-90',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60',
              isSpeaking ? 'text-teal-600' : 'text-stone-500 hover:text-stone-700',
            ].join(' ')}
          >
            {isSpeaking ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            )}
          </button>

          <FavoriteButton
            kind="parable"
            content={parable.fullText}
            context={parable.title}
          />

          <ShareButton
            kind="parable"
            content={parable.fullText}
            title={parable.title}
            context={parable.title}
          />
        </div>
      </div>

      {/* Scrollable reading surface. tabIndex=0 lets keyboard users scroll
          with arrow keys / PageUp / PageDown when the dialog has focus. */}
      <div
        tabIndex={0}
        className="overflow-y-auto h-[calc(100vh-3.5rem)] focus:outline-none"
      >
        <article className="max-w-2xl mx-auto px-6 py-8">
          <p className="text-sm uppercase tracking-widest text-amber-700 font-medium">
            {parable.reference}
          </p>

          <h1
            id="parable-reader-title"
            className="text-4xl font-serif text-stone-900 mt-3 leading-tight"
          >
            {parable.title}
          </h1>

          <div className="flex flex-wrap gap-1.5 mt-4 mb-8">
            {parable.themes.map((theme) => (
              <span
                key={theme}
                className="rounded-full bg-teal-100 text-teal-700 px-2 py-0.5 text-xs"
              >
                {theme}
              </span>
            ))}
          </div>

          <div className="text-xl font-serif text-stone-800 leading-relaxed whitespace-pre-line first-letter:text-6xl first-letter:font-bold first-letter:float-left first-letter:mr-2 first-letter:text-amber-700">
            {parable.fullText}
          </div>

          <hr className="my-10 border-stone-200" />

          <section>
            <h2 className="text-sm uppercase tracking-widest text-stone-500">
              Reflection
            </h2>
            <p className="text-base text-stone-700 mt-2">{parable.summary}</p>
          </section>

          {onAskAbout && (
            <div className="mt-10 mb-4">
              <button
                type="button"
                onClick={handleAskAbout}
                className="w-full rounded-full bg-teal-500 text-white text-base py-3 px-6 font-medium shadow-sm active:scale-[0.98] transition-transform hover:bg-teal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
              >
                Ask jAIsus about this parable
              </button>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
