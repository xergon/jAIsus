'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useHaptics } from '@/hooks/useHaptics';
import { saveVoiceMemo, MEMO_LIMITS } from '@/lib/voice-memos';
import { toast } from '@/lib/toast';
import { track } from '@/lib/analytics';

interface VoiceMemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Parent owns TTS — pass through useSpeechSynthesis from ChatInterface. */
  onSpeak: (text: string) => void;
  onStopSpeaking: () => void;
  isSpeaking: boolean;
}

interface Reflection {
  transcript: string;
  summary: string;
  themes: string[];
  response: string;
}

type ScreenState =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'processing'; durationSec: number }
  | { kind: 'result'; durationSec: number; reflection: Reflection }
  | { kind: 'error'; message: string };

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Convert a Blob to base64 string (no data-URL prefix). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const raw = String(reader.result ?? '');
      const idx = raw.indexOf(',');
      resolve(idx === -1 ? raw : raw.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

export function VoiceMemoModal({ isOpen, onClose, onSpeak, onStopSpeaking, isSpeaking }: VoiceMemoModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });
  const { vibrate } = useHaptics();

  const [screen, setScreen] = useState<ScreenState>({ kind: 'idle' });
  // Track in-flight processing so we can cancel cleanly on close.
  const abortRef = useRef<AbortController | null>(null);

  const submitRecording = useCallback(async (result: { blob: Blob; mimeType: string; durationSec: number }) => {
    setScreen({ kind: 'processing', durationSec: result.durationSec });
    try {
      const audioBase64 = await blobToBase64(result.blob);
      const controller = new AbortController();
      abortRef.current = controller;
      const resp = await fetch('/api/memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ audioBase64, mimeType: result.mimeType }),
      });
      abortRef.current = null;
      if (!resp.ok) {
        let msg = 'Could not process memo.';
        try {
          const errBody = await resp.json();
          if (typeof errBody?.error === 'string') msg = errBody.error;
        } catch { /* response might be HTML on hard 500 */ }
        setScreen({ kind: 'error', message: msg });
        return;
      }
      const data = (await resp.json()) as Reflection;
      setScreen({
        kind: 'result',
        durationSec: result.durationSec,
        reflection: {
          transcript: String(data.transcript ?? ''),
          summary: String(data.summary ?? ''),
          themes: Array.isArray(data.themes) ? data.themes.map(String) : [],
          response: String(data.response ?? ''),
        },
      });
      track('memo.processed', { durationSec: Math.round(result.durationSec) });
      vibrate('success');
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return; // user closed
      setScreen({ kind: 'error', message: 'Network hiccup. Try again?' });
    }
  }, [vibrate]);

  const onError = useCallback((message: string) => {
    setScreen({ kind: 'error', message });
  }, []);

  const recorder = useAudioRecorder({
    maxDurationSec: MEMO_LIMITS.maxDurationSec,
    onComplete: submitRecording,
    onError,
  });

  // Reset state every time the modal opens fresh.
  useEffect(() => {
    if (!isOpen) {
      // Abort an in-flight upload + stop any active TTS so close feels instant.
      abortRef.current?.abort();
      abortRef.current = null;
      if (recorder.state !== 'idle') recorder.cancel();
      if (isSpeaking) onStopSpeaking();
      setScreen({ kind: 'idle' });
    }
  }, [isOpen, recorder, isSpeaking, onStopSpeaking]);

  if (!isOpen) return null;

  const handleStart = async () => {
    vibrate('medium');
    setScreen({ kind: 'recording' });
    await recorder.start();
  };

  const handleStop = () => {
    vibrate('tap');
    recorder.stop();
  };

  const handleCancel = () => {
    vibrate('tap');
    recorder.cancel();
    setScreen({ kind: 'idle' });
  };

  const handleSave = () => {
    if (screen.kind !== 'result') return;
    const saved = saveVoiceMemo({
      durationSec: screen.durationSec,
      transcript: screen.reflection.transcript,
      summary: screen.reflection.summary,
      themes: screen.reflection.themes,
      response: screen.reflection.response,
    });
    if (saved) {
      toast.success('Memo saved');
      track('memo.saved');
      if (isSpeaking) onStopSpeaking();
      onClose();
    } else {
      toast.error("Couldn't save — storage may be full.");
    }
  };

  const handleDiscard = () => {
    if (isSpeaking) onStopSpeaking();
    setScreen({ kind: 'idle' });
  };

  const handleListen = () => {
    if (screen.kind !== 'result') return;
    if (isSpeaking) {
      onStopSpeaking();
    } else {
      onSpeak(screen.reflection.response);
      track('memo.listened');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="memo-title"
        className="relative w-full max-w-md max-h-[90vh] bg-white rounded-t-2xl shadow-2xl flex flex-col animate-slide-up"
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-stone-300" aria-hidden="true" />
        </div>

        <div className="px-5 pb-2">
          <h2 id="memo-title" className="text-lg font-bold text-stone-800">Voice memo</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Pour out what&apos;s on your heart. jAIsus listens, reflects, and speaks back.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto modal-scroll px-5 pb-6">
          {/* IDLE */}
          {screen.kind === 'idle' && (
            <div className="flex flex-col items-center justify-center py-12 gap-6">
              <div className="text-center max-w-xs">
                <div className="text-5xl mb-3" aria-hidden="true">🎙️</div>
                <p className="text-sm text-stone-600">
                  Up to {MEMO_LIMITS.maxDurationSec / 60} minutes. Speak freely — half-formed thoughts welcome.
                </p>
              </div>
              <button
                type="button"
                onClick={handleStart}
                disabled={!recorder.isSupported || recorder.state === 'requesting'}
                className="w-20 h-20 rounded-full bg-rose-500 text-white shadow-lg shadow-rose-200 active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center"
                aria-label="Start recording"
              >
                <span className="block w-6 h-6 rounded-full bg-white" aria-hidden="true" />
              </button>
              {!recorder.isSupported && (
                <p className="text-xs text-stone-500 max-w-xs text-center">
                  Audio recording isn&apos;t supported in this browser. Try Chrome or Safari.
                </p>
              )}
            </div>
          )}

          {/* RECORDING */}
          {screen.kind === 'recording' && (
            <div className="flex flex-col items-center justify-center py-12 gap-6">
              <div className="text-center">
                <p className="text-2xl font-mono text-stone-800" aria-live="polite">
                  {fmtTime(recorder.elapsedSec)}
                </p>
                <p className="text-xs text-stone-500 mt-1">
                  {recorder.state === 'requesting' ? 'Waiting for mic…' : 'Listening…'}
                </p>
              </div>
              {/* Live level meter — animates with mic amplitude */}
              <div
                className="w-full max-w-xs h-16 rounded-2xl bg-rose-50 flex items-center justify-center gap-1.5 px-4"
                aria-hidden="true"
              >
                {Array.from({ length: 20 }).map((_, i) => {
                  // Triangular envelope across the bar — center bars are taller when speaking.
                  const dist = Math.abs(i - 9.5) / 9.5;
                  const envelope = 1 - dist * 0.6;
                  const h = 12 + recorder.level * envelope * 44;
                  return (
                    <div
                      key={i}
                      className="w-1.5 rounded-full bg-rose-400 transition-all duration-75"
                      style={{ height: `${Math.min(56, h)}px` }}
                    />
                  );
                })}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-xl border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-600 active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="rounded-xl bg-rose-500 text-white px-6 py-2.5 text-sm font-semibold active:scale-[0.98] flex items-center gap-2"
                  aria-label="Stop recording and reflect"
                >
                  <span className="block w-3 h-3 rounded-sm bg-white" aria-hidden="true" /> Stop
                </button>
              </div>
              <p className="text-[11px] text-stone-400">
                Auto-stops at {MEMO_LIMITS.maxDurationSec / 60} min.
              </p>
            </div>
          )}

          {/* PROCESSING */}
          {screen.kind === 'processing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
              <p className="text-sm text-stone-600">Transcribing and reflecting…</p>
              <p className="text-[11px] text-stone-400">{fmtTime(screen.durationSec)} memo</p>
            </div>
          )}

          {/* RESULT */}
          {screen.kind === 'result' && (
            <div className="space-y-4 py-2">
              {/* Summary card */}
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
                <p className="text-[11px] uppercase tracking-wide text-amber-700 font-medium">jAIsus heard</p>
                <p className="text-sm text-amber-900 italic mt-1.5 leading-relaxed">
                  &ldquo;{screen.reflection.summary}&rdquo;
                </p>
                {screen.reflection.themes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {screen.reflection.themes.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[11px] font-medium"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Response with Listen button */}
              <div className="rounded-2xl bg-white border border-stone-200 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wide text-teal-700 font-medium">Reflection</p>
                  <button
                    type="button"
                    onClick={handleListen}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium active:scale-95 transition-transform ${
                      isSpeaking
                        ? 'bg-rose-500 text-white'
                        : 'bg-teal-500 text-white'
                    }`}
                    aria-label={isSpeaking ? 'Stop listening' : 'Listen to jAIsus'}
                  >
                    {isSpeaking ? '■ Stop' : '▶ Listen'}
                  </button>
                </div>
                <p className="text-sm text-stone-700 mt-2 leading-relaxed whitespace-pre-wrap">
                  {screen.reflection.response}
                </p>
              </div>

              {/* Transcript collapsible */}
              <details className="rounded-2xl bg-stone-50 border border-stone-200 p-3">
                <summary className="text-xs font-medium text-stone-600 cursor-pointer select-none">
                  See transcript
                </summary>
                <p className="text-xs text-stone-600 mt-2 leading-relaxed whitespace-pre-wrap">
                  {screen.reflection.transcript || '(no speech detected)'}
                </p>
              </details>

              {/* Save / Discard */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm font-medium text-stone-600 active:scale-[0.98]"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex-1 rounded-xl bg-amber-500 text-white py-2.5 text-sm font-semibold active:scale-[0.98]"
                >
                  Save memo
                </button>
              </div>
            </div>
          )}

          {/* ERROR */}
          {screen.kind === 'error' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <div className="text-4xl" aria-hidden="true">⚠️</div>
              <p className="text-sm text-stone-700 max-w-xs">{screen.message}</p>
              <button
                type="button"
                onClick={() => setScreen({ kind: 'idle' })}
                className="rounded-xl bg-teal-500 text-white px-5 py-2.5 text-sm font-medium active:scale-[0.98]"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
