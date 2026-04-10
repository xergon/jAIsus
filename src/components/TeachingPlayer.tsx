'use client';

import { useState } from 'react';
import { TEACHING_TOPICS } from '@/lib/constants';

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

  async function generateTeaching(topic: string) {
    setSelectedTopic(topic);
    setLoading(true);
    setTeaching('');

    try {
      const res = await fetch('/api/teachings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      setTeaching(data.teaching);
    } catch {
      setTeaching('Unable to generate teaching at this time. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[85vh] bg-white rounded-t-2xl shadow-2xl flex flex-col animate-slide-up">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-stone-300" />
        </div>

        <div className="px-5 pb-2">
          <h2 className="text-lg font-bold text-stone-800">Dynamic Teachings</h2>
          <p className="text-sm text-stone-500">Choose a topic to hear a teaching</p>
        </div>

        {/* Topic selector */}
        <div className="px-5 pb-3">
          <div className="flex flex-wrap gap-2">
            {TEACHING_TOPICS.map(topic => (
              <button
                key={topic.id}
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
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {loading && (
            <div className="flex flex-col items-center py-10 animate-fade-in">
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
              <p className="text-sm text-stone-500 mt-3">Preparing teaching...</p>
            </div>
          )}

          {!loading && teaching && (
            <div className="animate-fade-in">
              <div className="prose prose-sm text-stone-700 leading-relaxed whitespace-pre-line">
                {teaching}
              </div>

              <button
                onClick={() => isSpeaking ? onStopSpeaking() : onSpeak(teaching)}
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
            <div className="text-center py-10 text-stone-400">
              <p className="text-3xl mb-2">📖</p>
              <p className="text-sm">Select a topic above to begin</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
