'use client';

import { useState, useRef, useEffect } from 'react';
import { TEACHING_TOPICS } from '@/lib/constants';
import { useModalA11y } from '@/hooks/useModalA11y';
import { SkeletonCard } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { toast } from '@/lib/toast';
import { track } from '@/lib/analytics';

interface TeachingPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  onSpeak: (text: string) => void;
  isSpeaking: boolean;
  onStopSpeaking: () => void;
}

export function TeachingPlayer({ isOpen, onClose, onSpeak, isSpeaking, onStopSpeaking }: TeachingPlayerProps) {
  const [teaching, setTeaching] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });
  // Audit fix: track in-flight fetch so closing the modal cancels it instead
  // of letting the response resolve into a setState on an unmounted modal.
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight generation when the modal closes.
  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [isOpen]);

  // Cancel on unmount too.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  async function generateTeaching(topic: string) {
    // Cancel a prior in-flight request (rapid topic switching).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSelectedTopic(topic);
    setLoading(true);
    setTeaching('');

    try {
      const res = await fetch('/api/teachings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
        signal: controller.signal,
      });
      if (!res.ok) {
        // Could be 429 (rate limit) or 400 (invalid topic) — surface generic message
        setTeaching('Unable to generate teaching right now. Please try again in a moment.');
        toast.error('Could not generate teaching right now.');
        return;
      }
      const data = await res.json();
      if (typeof data.teaching === 'string' && data.teaching.length > 0) {
        setTeaching(data.teaching);
        track('teaching.generated', { topic });
      } else {
        setTeaching('Unable to generate teaching at this time. Please try again.');
        toast.error('Could not generate teaching right now.');
      }
    } catch (err) {
      // AbortError = user closed the modal; not an error to surface.
      if ((err as Error)?.name === 'AbortError') return;
      setTeaching('Unable to generate teaching at this time. Please try again.');
      toast.error('Could not generate teaching right now.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="teaching-title"
        className="relative w-full max-w-md max-h-[85vh] bg-white rounded-t-2xl shadow-2xl flex flex-col animate-slide-up"
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-stone-300" aria-hidden="true" />
        </div>

        <div className="px-5 pb-2">
          <h2 id="teaching-title" className="text-lg font-bold text-stone-800">Dynamic Teachings</h2>
          <p className="text-sm text-stone-500">Choose a topic to hear a teaching</p>
        </div>

        {/* Topic selector */}
        <div className="px-5 pb-3">
          <div className="flex flex-wrap gap-2">
            {TEACHING_TOPICS.map(topic => (
              <button
                key={topic.id}
                type="button"
                onClick={() => generateTeaching(topic.id)}
                disabled={loading}
                className={`rounded-full px-3 py-1.5 text-sm font-medium border transition-colors
                  ${selectedTopic === topic.id
                    ? 'bg-teal-500 text-white border-teal-500'
                    : 'bg-white text-stone-600 border-stone-200 hover:border-teal-300'
                  }
                  disabled:opacity-50`}
              >
                {topic.icon} {topic.label}
              </button>
            ))}
          </div>
        </div>

        {/* Teaching content */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 modal-scroll">
          {loading && (
            <div className="py-2 animate-fade-in" aria-live="polite" aria-busy="true">
              <span className="sr-only">Preparing teaching...</span>
              <SkeletonCard />
            </div>
          )}

          {!loading && teaching && (
            <div className="animate-fade-in">
              <div className="prose prose-sm text-stone-700 leading-relaxed whitespace-pre-line">
                {teaching}
              </div>

              <button
                type="button"
                onClick={() => isSpeaking ? onStopSpeaking() : onSpeak(teaching)}
                aria-pressed={isSpeaking}
                aria-label={isSpeaking ? 'Stop listening' : 'Listen to teaching'}
                className={`mt-4 w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold
                  active:scale-[0.98] transition-transform ${
                  isSpeaking
                    ? 'bg-red-500 text-white'
                    : 'bg-teal-500 text-white'
                }`}
              >
                {isSpeaking ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                      <rect x="4" y="4" width="12" height="12" rx="2" />
                    </svg>
                    Stop Listening
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                    Listen to Teaching
                  </>
                )}
              </button>
            </div>
          )}

          {!loading && !teaching && !selectedTopic && (
            <EmptyState
              icon="📖"
              title="Pick a topic"
              description="Tap one of the topics above to receive a teaching."
            />
          )}
        </div>
      </div>
    </div>
  );
}
