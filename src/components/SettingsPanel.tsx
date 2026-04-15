'use client';

import { useState, useEffect } from 'react';
import { VOICE_OPTIONS, DEFAULT_VOICE_ID } from '@/lib/constants';
import { setStoredVoiceId } from '@/hooks/useSpeechSynthesis';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  autoSpeak: boolean;
  onToggleAutoSpeak: () => void;
  onClearHistory: () => void;
  onTestVoice?: (voiceId: string) => void;
}

export function SettingsPanel({
  isOpen,
  onClose,
  autoSpeak,
  onToggleAutoSpeak,
  onClearHistory,
  onTestVoice,
}: SettingsPanelProps) {
  const [cleared, setCleared] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_VOICE_ID);
  const [testing, setTesting] = useState(false);

  // Load saved voice on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('jaisus-voice-id');
        if (saved) setSelectedVoice(saved);
      } catch { /* */ }
    }
  }, []);

  function handleVoiceChange(voiceId: string) {
    setSelectedVoice(voiceId);
    setStoredVoiceId(voiceId);
  }

  async function handleTestVoice() {
    if (testing) return;
    setTesting(true);
    if (onTestVoice) {
      onTestVoice(selectedVoice);
    }
    setTimeout(() => setTesting(false), 3000);
  }

  function handleClear() {
    onClearHistory();
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl shadow-2xl p-5 animate-slide-up">
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full bg-stone-300" />
        </div>

        <h2 className="text-lg font-bold text-stone-800">Settings</h2>

        <div className="mt-4 space-y-4">
          {/* Auto-speak toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-stone-800">Auto-speak responses</p>
              <p className="text-xs text-stone-500">Read AI responses aloud automatically</p>
            </div>
            <button
              onClick={onToggleAutoSpeak}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                autoSpeak ? 'bg-teal-500' : 'bg-stone-300'
              }`}
            >
              <span
                className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                  autoSpeak ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Voice selection */}
          <div>
            <p className="text-sm font-medium text-stone-800 mb-1.5">Voice</p>
            <div className="flex gap-2">
              <select
                value={selectedVoice}
                onChange={e => handleVoiceChange(e.target.value)}
                className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800
                  focus:outline-none focus:ring-2 focus:ring-teal-400"
              >
                {VOICE_OPTIONS.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.desc}
                  </option>
                ))}
              </select>
              <button
                onClick={handleTestVoice}
                disabled={testing}
                className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700
                  active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {testing ? '...' : 'Test'}
              </button>
            </div>
          </div>

          {/* Clear chat history */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-stone-800">Chat history</p>
              <p className="text-xs text-stone-500">Clear all conversation data</p>
            </div>
            <button
              onClick={handleClear}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600
                active:scale-[0.98] transition-transform"
            >
              {cleared ? 'Cleared!' : 'Clear'}
            </button>
          </div>

          {/* About */}
          <div className="border-t border-stone-200 pt-4">
            <p className="text-sm font-medium text-stone-800">About jAIsus</p>
            <p className="text-xs text-stone-500 mt-1">
              An AI spiritual companion powered by Claude. jAIsus provides guidance
              grounded in biblical teachings and parables. Not a replacement for
              spiritual counsel or professional advice.
            </p>
            <p className="text-xs text-stone-400 mt-2">Version 1.0.0</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-xl border border-stone-200 py-2.5 text-sm font-medium text-stone-600
            active:scale-[0.98] transition-transform"
        >
          Done
        </button>
      </div>
    </div>
  );
}
