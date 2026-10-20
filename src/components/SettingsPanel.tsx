'use client';

import { useState, useEffect, useRef } from 'react';
import { VOICE_OPTIONS, DEFAULT_VOICE_ID } from '@/lib/constants';
import { setStoredVoiceId, setVoiceOverride } from '@/hooks/useSpeechSynthesis';
import { PERSONALITIES, getPersonality } from '@/lib/personalities';
import { listCustomPersonalities, CUSTOM_CHANGED_EVENT, type CustomPersonality } from '@/lib/custom-personalities';
import { useModalA11y } from '@/hooks/useModalA11y';
import { toast } from '@/lib/toast';
import { ExportButton } from './ExportButton';

const VISION_INTERVAL_OPTIONS = [
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
  { value: 300, label: '5 min' },
];

export const DEFAULT_VISION_INTERVAL = 30; // seconds

export function getStoredVisionInterval(): number {
  if (typeof window === 'undefined') return DEFAULT_VISION_INTERVAL;
  try {
    const saved = localStorage.getItem('jaisus-vision-interval');
    return saved ? parseInt(saved, 10) : DEFAULT_VISION_INTERVAL;
  } catch { return DEFAULT_VISION_INTERVAL; }
}

// The voice in use, or the default when none is stored or the stored one is
// no longer offered (the server falls back to the default the same way).
function readStoredVoiceId(): string {
  try {
    const saved = localStorage.getItem('jaisus-voice-id');
    if (saved && VOICE_OPTIONS.some(v => v.id === saved)) return saved;
  } catch { /* storage unavailable */ }
  return DEFAULT_VOICE_ID;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  autoSpeak: boolean;
  onToggleAutoSpeak: () => void;
  onClearHistory: () => void;
  onTestVoice?: (voiceId: string) => void;
  visionInterval: number;
  onVisionIntervalChange: (seconds: number) => void;
  cameraActive: boolean;
  personalityId: string;
  onPersonalityChange: (id: string) => void;
  /** Voice barge-in (VAD): talking while jAIsus speaks interrupts him. */
  vadEnabled: boolean;
  onToggleVad: () => void;
  onOpenCreator?: () => void;
}

export function SettingsPanel({
  isOpen,
  onClose,
  autoSpeak,
  onToggleAutoSpeak,
  onClearHistory,
  onTestVoice,
  visionInterval,
  onVisionIntervalChange,
  cameraActive,
  personalityId,
  onPersonalityChange,
  vadEnabled,
  onToggleVad,
  onOpenCreator,
}: SettingsPanelProps) {
  const [cleared, setCleared] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_VOICE_ID);
  const [testing, setTesting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const testTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });

  // Cleanup pending timeouts on unmount or close to prevent state updates after dismount
  useEffect(() => {
    return () => {
      if (testTimeoutRef.current) clearTimeout(testTimeoutRef.current);
      if (clearedTimeoutRef.current) clearTimeout(clearedTimeoutRef.current);
    };
  }, []);

  // Show the voice in use each time the sheet opens. Reading it only on mount
  // showed a stale voice: ChatInterface sets the personality's voice after
  // this panel mounts, and switching personality changes it again. Adjusted
  // during render (React's "store info from previous renders" pattern).
  const voiceSyncKey = isOpen ? personalityId : null;
  const [syncedVoiceKey, setSyncedVoiceKey] = useState<string | null>(null);
  if (voiceSyncKey !== syncedVoiceKey) {
    setSyncedVoiceKey(voiceSyncKey);
    if (voiceSyncKey !== null) setSelectedVoice(readStoredVoiceId());
  }

  // User-made personalities, read each time the sheet opens and kept in sync
  // while it is open (the creator, or another tab, can change them).
  const [customList, setCustomList] = useState<CustomPersonality[]>([]);
  const [listedOpen, setListedOpen] = useState(false);
  if (isOpen !== listedOpen) {
    setListedOpen(isOpen);
    if (isOpen) setCustomList(listCustomPersonalities());
  }
  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => setCustomList(listCustomPersonalities());
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'jaisus-custom-personalities' || e.key === null) refresh();
    };
    window.addEventListener(CUSTOM_CHANGED_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CUSTOM_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [isOpen]);

  function handleVoiceChange(voiceId: string) {
    setSelectedVoice(voiceId);
    setStoredVoiceId(voiceId);
    // Kept for this personality across reloads; its own voice needs no override.
    setVoiceOverride(personalityId, voiceId === getPersonality(personalityId).voiceId ? null : voiceId);
    const voice = VOICE_OPTIONS.find(v => v.id === voiceId);
    if (voice) toast.info(`Voice set to ${voice.name}`);
  }

  async function handleTestVoice() {
    if (testing) return;
    setTesting(true);
    if (onTestVoice) {
      onTestVoice(selectedVoice);
    }
    if (testTimeoutRef.current) clearTimeout(testTimeoutRef.current);
    testTimeoutRef.current = setTimeout(() => setTesting(false), 3000);
  }

  function handleClear() {
    onClearHistory();
    setCleared(true);
    toast.success('Chat history cleared');
    if (clearedTimeoutRef.current) clearTimeout(clearedTimeoutRef.current);
    clearedTimeoutRef.current = setTimeout(() => setCleared(false), 2000);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative w-full max-w-md max-h-[90vh] [@supports(height:1dvh)]:max-h-[90dvh] overflow-y-auto overscroll-contain modal-scroll bg-white rounded-t-2xl shadow-2xl p-5 animate-slide-up"
      >
        <div className="flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full bg-stone-300" aria-hidden="true" />
        </div>

        <h2 id="settings-title" className="text-lg font-bold text-stone-800">Settings</h2>

        <div className="mt-4 space-y-4">
          {/* Personality selector */}
          <div>
            <p className="text-sm font-medium text-stone-800 mb-2">Personality</p>
            <div className="grid grid-cols-2 gap-2">
              {[...PERSONALITIES, ...customList].map(p => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={personalityId === p.id}
                  onClick={() => {
                    onPersonalityChange(p.id);
                    // Only toast on an actual change, not when re-tapping the current selection.
                    if (p.id !== personalityId) {
                      toast.success(`Switched to ${p.name}`);
                    }
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-all ${
                    personalityId === p.id
                      ? 'bg-amber-100 border-2 border-amber-500 shadow-sm'
                      : 'bg-stone-50 border-2 border-transparent'
                  }`}
                >
                  <span className="text-lg">{p.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-stone-800 truncate">{p.name}</p>
                    <p className="text-[10px] text-stone-500 truncate">{p.desc}</p>
                  </div>
                </button>
              ))}
              {onOpenCreator && (
                <button
                  type="button"
                  onClick={onOpenCreator}
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-left bg-white border-2 border-dashed border-stone-300 transition-all active:scale-[0.98]"
                >
                  <span className="text-lg text-stone-500 w-6 text-center" aria-hidden="true">+</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-stone-800 truncate">Create your own</p>
                    <p className="text-[10px] text-stone-500 truncate">Design a new personality</p>
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* Auto-speak toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p id="settings-autospeak-label" className="text-sm font-medium text-stone-800">Auto-speak responses</p>
              <p className="text-xs text-stone-500">Read AI responses aloud automatically</p>
            </div>
            <button
              type="button"
              aria-pressed={autoSpeak}
              aria-labelledby="settings-autospeak-label"
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

          {/* Voice barge-in toggle */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p id="settings-vad-label" className="text-sm font-medium text-stone-800">Listen for interruptions</p>
              <p className="text-xs text-stone-500">
                {autoSpeak
                  ? 'Start talking while jAIsus speaks to stop him and be heard'
                  : 'Works when Auto-speak is on'}
              </p>
            </div>
            <button
              type="button"
              aria-pressed={vadEnabled}
              aria-labelledby="settings-vad-label"
              onClick={onToggleVad}
              className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${
                vadEnabled ? 'bg-teal-500' : 'bg-stone-300'
              }`}
            >
              <span
                className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                  vadEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Vision interval */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <p className="text-sm font-medium text-stone-800">Vision interval</p>
                <p className="text-xs text-stone-500">
                  {cameraActive ? 'How often Jesus comments on what he sees' : 'Enable camera to use vision'}
                </p>
              </div>
            </div>
            <div className="flex gap-1.5">
              {VISION_INTERVAL_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onVisionIntervalChange(opt.value)}
                  disabled={!cameraActive}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                    visionInterval === opt.value
                      ? 'bg-amber-500 text-white'
                      : 'bg-stone-100 text-stone-600 disabled:opacity-40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
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

          {/* Export your data */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-stone-800">Export your data</p>
              <p className="text-xs text-stone-500">Download chats and favorites as Markdown, JSON, or plain text</p>
            </div>
            <ExportButton />
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
            <p className="text-xs text-stone-500 mt-2">Version 1.0.0</p>
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
