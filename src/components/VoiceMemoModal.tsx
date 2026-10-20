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
  /** Called after save — opens the Saved Memos panel so the user can see
   *  what they just kept. Removes the "stranded memo" UX trap. */
  onOpenSaved?: () => void;
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
  /** canRetry: the recording is kept and can be sent again. */
  | { kind: 'error'; message: string; canRetry?: boolean };

type Recording = { blob: Blob; mimeType: string; durationSec: number };

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

export function VoiceMemoModal({ isOpen, onClose, onSpeak, onStopSpeaking, isSpeaking, onOpenSaved }: VoiceMemoModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { vibrate } = useHaptics();

  const [screen, setScreen] = useState<ScreenState>({ kind: 'idle' });
  // Confirm-then-execute for Cancel when >30s of audio is at stake.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const cancelConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Same two-tap guard for the backdrop / Escape while a memo is at stake.
  const [confirmingClose, setConfirmingClose] = useState(false);
  const closeConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After ~6s of processing we swap reassurance copy; after ~20s, swap again.
  // This lives in state so the render reflects the message change.
  const [processingHint, setProcessingHint] = useState<0 | 1 | 2>(0);
  // Track in-flight processing so we can cancel cleanly on close.
  const abortRef = useRef<AbortController | null>(null);
  // Refs so the close-cleanup effect can depend ONLY on isOpen (audit H1).
  // The recorder object identity changes every render of this component, so
  // depending on it would re-arm the cleanup effect 60× per second during a
  // recording (level meter writes setLevel). Refs let us read the latest
  // values without triggering re-runs.
  const isSpeakingRef = useRef(isSpeaking);
  const onStopSpeakingRef = useRef(onStopSpeaking);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { onStopSpeakingRef.current = onStopSpeaking; }, [onStopSpeaking]);

  // The recording being processed, kept until it succeeds so a network or
  // server failure doesn't throw away minutes of audio.
  const lastRecordingRef = useRef<Recording | null>(null);

  const submitRecording = useCallback(async (result: Recording) => {
    lastRecordingRef.current = result;
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
        // Rate limits and server errors can pass; a bad, too long or silent
        // recording (400/413/415/422) would fail the same way again.
        const canRetry = resp.status === 429 || resp.status >= 500;
        if (!canRetry) lastRecordingRef.current = null;
        setScreen({ kind: 'error', message: msg, canRetry });
        return;
      }
      const data = (await resp.json()) as Reflection;
      lastRecordingRef.current = null;
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
      setScreen({ kind: 'error', message: 'Network hiccup. Try again?', canRetry: true });
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
  // Stable ref to the recorder so the close-cleanup effect can depend on isOpen only.
  const recorderRef = useRef(recorder);
  useEffect(() => { recorderRef.current = recorder; }, [recorder]);

  // Backdrop taps and Escape come through here. Closing cancels the recording,
  // aborts processing and drops an unsaved reflection, so ask for a second
  // close first when that would lose something.
  const requestClose = () => {
    const atStake =
      screen.kind === 'processing' ||
      screen.kind === 'result' ||
      (screen.kind === 'error' && screen.canRetry === true) ||
      (screen.kind === 'recording' && recorder.elapsedSec >= 30);
    if (atStake && !confirmingClose) {
      vibrate('warning');
      setConfirmingClose(true);
      toast.info(
        screen.kind === 'result'
          ? "This reflection isn't saved. Close again to discard it."
          : screen.kind === 'processing'
            ? 'jAIsus is still reflecting. Close again to discard this memo.'
            : screen.kind === 'error'
              ? "This memo wasn't sent. Close again to discard it."
              : 'Still recording. Close again to discard it.',
        { duration: 3000 }
      );
      if (closeConfirmTimerRef.current) clearTimeout(closeConfirmTimerRef.current);
      closeConfirmTimerRef.current = setTimeout(() => {
        setConfirmingClose(false);
        closeConfirmTimerRef.current = null;
      }, 3000);
      return;
    }
    onClose();
  };
  useModalA11y({ isOpen, onClose: requestClose, ref: dialogRef });

  // Sync the modal's `screen` from the hook's `recorder.state` for the
  // transient 'requesting'/'recording' window. If the user dismisses the
  // mic permission prompt, the hook returns to 'idle' and we want the modal
  // to follow — otherwise we'd be stuck showing the recording UI for a
  // recording that never began (audit C1). Adjusted during render.
  // If the recorder dropped back to idle (permission denied, mic in use,
  // or any sync error in the hook), unstick the modal.
  if (isOpen && screen.kind === 'recording' && recorder.state === 'idle') {
    setScreen({ kind: 'idle' });
  }

  // Reset state every time the modal CLOSES (adjusted during render; the
  // recorder, request, speech and timers are stopped in the effect below).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setScreen({ kind: 'idle' });
      setConfirmingCancel(false);
      setConfirmingClose(false);
    }
  }

  // Back to the first reassurance line whenever the screen changes (the
  // effect below advances it while processing).
  const [hintScreen, setHintScreen] = useState(screen.kind);
  if (screen.kind !== hintScreen) {
    setHintScreen(screen.kind);
    setProcessingHint(0);
  }

  // Depends only on isOpen so it doesn't fire 60× per second during
  // recording (audit H1).
  useEffect(() => {
    if (isOpen) return;
    abortRef.current?.abort();
    abortRef.current = null;
    lastRecordingRef.current = null;
    if (recorderRef.current.state !== 'idle') recorderRef.current.cancel();
    if (isSpeakingRef.current) onStopSpeakingRef.current();
    if (cancelConfirmTimerRef.current) {
      clearTimeout(cancelConfirmTimerRef.current);
      cancelConfirmTimerRef.current = null;
    }
    if (closeConfirmTimerRef.current) {
      clearTimeout(closeConfirmTimerRef.current);
      closeConfirmTimerRef.current = null;
    }
  }, [isOpen]);

  // Rotate processing-screen copy at 6s and 20s so the user doesn't think
  // the request hung. Tied to screen.kind so it resets cleanly when we
  // leave the processing state.
  useEffect(() => {
    if (screen.kind !== 'processing') return;
    const t6 = setTimeout(() => setProcessingHint(1), 6_000);
    const t20 = setTimeout(() => setProcessingHint(2), 20_000);
    return () => {
      clearTimeout(t6);
      clearTimeout(t20);
    };
  }, [screen.kind]);

  // When the screen state changes mid-modal (recording → processing →
  // result), focus may be on a button that just unmounted, leaving the
  // SR user dropped out of the dialog. Re-trap by focusing the first
  // focusable element in the dialog (audit M4).
  useEffect(() => {
    if (!isOpen) return;
    const root = dialogRef.current;
    if (!root) return;
    if (root.contains(document.activeElement)) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea'
    );
    focusables[0]?.focus();
  }, [screen.kind, isOpen]);

  // On iOS, opening the modal while the chat textarea is focused leaves the
  // keyboard up — and since the modal slides up to `items-end`, it ends up
  // BEHIND the keyboard. Blur the active element when we open (audit UX H3).
  // Only when it's outside the dialog: useModalA11y has usually moved focus
  // to Start already (which closes the keyboard too), and blurring that
  // dropped keyboard and screen-reader focus onto <body>.
  useEffect(() => {
    if (!isOpen) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !dialogRef.current?.contains(active)
    ) {
      active.blur();
    }
  }, [isOpen]);

  // Cleanup pending confirm timers on unmount.
  useEffect(() => {
    return () => {
      if (cancelConfirmTimerRef.current) clearTimeout(cancelConfirmTimerRef.current);
      if (closeConfirmTimerRef.current) clearTimeout(closeConfirmTimerRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const handleStart = async () => {
    // Guard against re-entry — useAudioRecorder also no-ops if state !== 'idle'
    // but checking here avoids the brief screen-flicker if the user double-taps.
    if (recorder.state !== 'idle') return;
    vibrate('medium');
    setScreen({ kind: 'recording' });
    await recorder.start();
    // If start() bailed (permission denied, unsupported), the hook stayed in
    // 'idle'. The screen-sync effect above will pull us back to idle.
  };

  const handleStop = () => {
    vibrate('tap');
    recorder.stop();
  };

  const handleCancel = () => {
    // Two-tap confirm if there's meaningful audio at stake (audit UX M3).
    const elapsedSec = recorder.elapsedSec;
    if (elapsedSec >= 30 && !confirmingCancel) {
      vibrate('warning');
      setConfirmingCancel(true);
      if (cancelConfirmTimerRef.current) clearTimeout(cancelConfirmTimerRef.current);
      cancelConfirmTimerRef.current = setTimeout(() => {
        setConfirmingCancel(false);
        cancelConfirmTimerRef.current = null;
      }, 3000);
      return;
    }
    if (cancelConfirmTimerRef.current) {
      clearTimeout(cancelConfirmTimerRef.current);
      cancelConfirmTimerRef.current = null;
    }
    vibrate('tap');
    setConfirmingCancel(false);
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
      // Route the user to the saved-memos panel via the parent so they can
      // see what they just kept — closes the audit UX C1 "stranded memo" gap.
      // Toast offers a quick way back in case they ignore the panel transition.
      track('memo.saved');
      if (isSpeaking) onStopSpeaking();
      if (onOpenSaved) {
        toast.success('Memo saved');
        onOpenSaved();
      } else {
        toast.success('Memo saved');
        onClose();
      }
    } else {
      toast.error("Couldn't save — storage may be full.");
    }
  };

  const handleRetry = () => {
    const recording = lastRecordingRef.current;
    if (!recording) {
      setScreen({ kind: 'idle' });
      return;
    }
    vibrate('tap');
    void submitRecording(recording);
  };

  const handleStartOver = () => {
    lastRecordingRef.current = null;
    setScreen({ kind: 'idle' });
  };

  const handleDiscard = () => {
    if (isSpeaking) onStopSpeaking();
    setScreen({ kind: 'idle' });
  };

  const handleListen = () => {
    if (screen.kind !== 'result') return;
    if (isSpeaking) {
      onStopSpeaking();
      track('memo.listen.stop');
    } else {
      onSpeak(screen.reflection.response);
      track('memo.listen.play');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={requestClose} aria-hidden="true" />
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
            <div className="flex flex-col items-center justify-center py-12 gap-5">
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
              {/* Visible CTA label — audit UX H1: first-time users see an
                  unlabeled red button and don't know what to do. */}
              <p className="text-xs font-medium text-stone-500">Tap to start</p>
              {onOpenSaved && (
                <button
                  type="button"
                  onClick={onOpenSaved}
                  className="text-xs text-teal-700 underline-offset-2 hover:underline active:scale-[0.98]"
                >
                  View saved memos
                </button>
              )}
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
                  className={`rounded-xl px-5 py-2.5 text-sm font-medium active:scale-[0.98] ${
                    confirmingCancel
                      ? 'bg-rose-100 border border-rose-300 text-rose-700 font-semibold'
                      : 'border border-stone-200 text-stone-600'
                  }`}
                  aria-label={confirmingCancel ? 'Confirm discard recording' : 'Cancel recording'}
                >
                  {confirmingCancel ? 'Tap again to discard' : 'Cancel'}
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
            <div
              className="flex flex-col items-center justify-center py-16 gap-4"
              aria-live="polite"
            >
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
              {/* Rotating reassurance copy — long memos can take 20s+, so we
                  give the user a sign the request hasn't hung (audit UX M2). */}
              <p className="text-sm text-stone-600">
                {processingHint === 0 && 'Transcribing and reflecting…'}
                {processingHint === 1 && 'Almost there — long memos take a moment.'}
                {processingHint === 2 && 'Still working — listening deeply takes time.'}
              </p>
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
              {/* "Try again" re-sends the kept recording; "Start over" drops it
                  and returns to the idle screen (audit UX L2). */}
              <div className="flex gap-3">
                {screen.canRetry && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="rounded-xl bg-teal-500 text-white px-5 py-2.5 text-sm font-medium active:scale-[0.98]"
                  >
                    Try again
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleStartOver}
                  className={
                    screen.canRetry
                      ? 'rounded-xl border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-600 active:scale-[0.98]'
                      : 'rounded-xl bg-teal-500 text-white px-5 py-2.5 text-sm font-medium active:scale-[0.98]'
                  }
                >
                  Start over
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
