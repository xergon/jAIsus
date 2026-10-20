'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onspeechend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
}

interface WindowWithSpeech {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

/** Why a listen ended: something was heard and sent, nothing was said, or recognition failed. */
export type SpeechSessionEnd = 'result' | 'empty' | 'error';

interface SpeechRecognitionHookResult {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  isSupported: boolean;
  error: string | null;
  start: () => void;
  /** Stops listening and sends what was heard. Returns true if something was sent. */
  stop: () => boolean;
  /** Stops listening and throws away what was heard. */
  cancel: () => void;
  clearError: () => void;
}

// Once the user has started talking, listening ends after this much silence.
const SILENCE_MS = 4500;
// With no speech at all, listening gives up after this long. Counted from when
// the mic actually starts listening, not from start(): a first-time
// permission prompt can take longer than this to answer.
const NO_SPEECH_MS = 10000;
// Fallback until then, for a prompt left open or a browser without 'start'.
const START_WAIT_MS = 60000;

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access denied. Please allow microphone access in your browser settings.',
  'service-not-allowed': 'Speech recognition is blocked in this browser. You can type instead.',
  'audio-capture': 'No microphone found. Check that one is connected and allowed.',
  'network': 'Speech recognition needs an internet connection. Please try again.',
  'language-not-supported': 'Speech recognition is not available for this language.',
};

function joinText(a: string, b: string): string {
  return [a.trim(), b.trim()].filter(Boolean).join(' ');
}

/**
 * Listens until the user has been silent for SILENCE_MS, then sends what was
 * heard through onResult.
 *
 * Browsers end recognition sessions on their own: Android Chrome and iOS
 * Safari on short pauses (even with continuous = true), desktop Chrome after a
 * no-speech timeout or about a minute. Each such end starts a new session and
 * keeps the text heard so far, so a pause shorter than SILENCE_MS never cuts
 * the user off.
 */
export function useSpeechRecognition(
  onResult?: (transcript: string) => void,
  onSessionEnd?: (reason: SpeechSessionEnd) => void,
): SpeechRecognitionHookResult {
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onResultRef = useRef(onResult);
  const onSessionEndRef = useRef(onSessionEnd);
  // The listen in progress; finish() ends it ('submit' sends what was heard).
  const listenRef = useRef<{ finish: (mode: 'submit' | 'cancel') => boolean } | null>(null);
  // Set on unmount so a listen that ends afterwards calls nothing.
  const unmountedRef = useRef(false);

  // Keep callback refs updated without causing re-renders
  useEffect(() => {
    onResultRef.current = onResult;
    onSessionEndRef.current = onSessionEnd;
  }, [onResult, onSessionEnd]);

  useEffect(() => {
    const w = window as unknown as WindowWithSpeech;
    const supported = typeof window !== 'undefined' &&
      (!!w.SpeechRecognition || !!w.webkitSpeechRecognition);
    setIsSupported(supported);
  }, []);

  const stop = useCallback(() => listenRef.current?.finish('submit') ?? false, []);
  const cancel = useCallback(() => { listenRef.current?.finish('cancel'); }, []);
  const clearError = useCallback(() => setError(null), []);

  const start = useCallback(() => {
    if (!isSupported) {
      setError('Speech recognition is not supported in this browser');
      return;
    }
    // Already listening: keep the current listen (and what it has heard).
    if (listenRef.current) return;

    const w = window as unknown as WindowWithSpeech;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognition) { setError('Speech recognition not available'); return; }

    // Android Chrome repeats earlier words in each new final result.
    const cumulativeResults = /Android/i.test(navigator.userAgent);

    let committed = '';   // text from earlier sessions of this listen
    let sessionText = ''; // text of the current session
    let heardSpeech = false;
    let done = false;
    let recognition: SpeechRecognitionInstance | null = null;
    let sessionStartedAt = 0;
    let quickEnds = 0;
    let silenceTimer: ReturnType<typeof setTimeout> | undefined;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;
    let noSpeechTimer: ReturnType<typeof setTimeout> | undefined;
    // The NO_SPEECH_MS window is armed on the first session's start only:
    // re-arming on every browser-ended restart would keep a silent listen
    // (and the hands-free mic) open forever.
    let noSpeechArmed = false;

    const heard = () => joinText(committed, sessionText);

    function finish(mode: 'submit' | 'cancel' | 'error'): boolean {
      if (done) return false;
      done = true;
      clearTimeout(silenceTimer);
      clearTimeout(noSpeechTimer);
      clearTimeout(restartTimer);
      if (listenRef.current === handle) listenRef.current = null;
      const rec = recognition;
      recognition = null;
      if (rec) {
        rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
        try { rec.abort(); } catch { /* already ended */ }
      }
      const text = heard();
      // Cleared in the same callback as onResult so React batches them with
      // the caller's state change (the mic doesn't linger in 'listening').
      setIsListening(false);
      setInterimTranscript('');
      if (unmountedRef.current || mode === 'cancel') return false;
      if (text) {
        setTranscript(text);
        onResultRef.current?.(text);
      }
      onSessionEndRef.current?.(mode === 'error' ? 'error' : text ? 'result' : 'empty');
      return !!text;
    }

    function armSilenceTimer() {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => finish('submit'), SILENCE_MS);
    }

    function armNoSpeechTimer(ms: number) {
      clearTimeout(noSpeechTimer);
      noSpeechTimer = setTimeout(() => { if (!heardSpeech) finish('submit'); }, ms);
    }

    function startSession() {
      if (done) return;
      const rec = new SpeechRecognition!();
      recognition = rec;
      sessionText = '';
      sessionStartedAt = 0;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onstart = () => {
        sessionStartedAt = Date.now();
        if (!noSpeechArmed && !heardSpeech) {
          noSpeechArmed = true;
          armNoSpeechTimer(NO_SPEECH_MS);
        }
      };

      rec.onresult = (event) => {
        if (rec !== recognition) return;
        let finals = '';
        let interim = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const t = result[0].transcript;
          if (!result.isFinal) interim = joinText(interim, t);
          else if (cumulativeResults && finals && t.trim().toLowerCase().startsWith(finals.toLowerCase())) finals = t.trim();
          else finals = joinText(finals, t);
        }
        const text = cumulativeResults && finals && interim.toLowerCase().startsWith(finals.toLowerCase())
          ? interim
          : joinText(finals, interim);
        if (text) {
          sessionText = text;
          if (!heardSpeech) {
            heardSpeech = true;
            clearTimeout(noSpeechTimer);
            setError(null);
          }
          setInterimTranscript(heard());
        }
        // Chrome sends empty interim results while still processing a long
        // sentence; once the user has spoken they count as activity too.
        if (heardSpeech) armSilenceTimer();
      };

      rec.onerror = (event) => {
        if (rec !== recognition) return;
        // The session ends after these; onend decides whether to go on.
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        console.warn('Speech recognition error:', event.error);
        setError(ERROR_MESSAGES[event.error] ?? 'Speech recognition stopped. Please try again.');
        finish('error');
      };

      rec.onend = () => {
        if (rec !== recognition) return;
        committed = heard();
        sessionText = '';
        recognition = null;
        // A browser that ends every session at once can't be kept listening,
        // and a backgrounded page can't restart the mic.
        quickEnds = sessionStartedAt && Date.now() - sessionStartedAt > 1000 ? 0 : quickEnds + 1;
        if (document.hidden || quickEnds >= 3) {
          finish('submit');
          return;
        }
        restartTimer = setTimeout(startSession, 100);
      };

      try {
        rec.start();
      } catch (err) {
        console.warn('Failed to start recognition:', err);
        recognition = null;
        if (++quickEnds >= 3) {
          setError('Failed to start speech recognition. Please try again.');
          finish('error');
        } else {
          restartTimer = setTimeout(startSession, 300);
        }
      }
    }

    const handle = { finish: (mode: 'submit' | 'cancel') => finish(mode) };
    listenRef.current = handle;
    armNoSpeechTimer(START_WAIT_MS);
    setError(null);
    setTranscript('');
    setInterimTranscript('');
    setIsListening(true);
    startSession();
  }, [isSupported]);

  useEffect(() => {
    unmountedRef.current = false;
    const listen = listenRef;
    return () => {
      // Unmount: end any listen without calling back into the unmounted owner.
      unmountedRef.current = true;
      listen.current?.finish('cancel');
    };
  }, []);

  return { transcript, interimTranscript, isListening, isSupported, error, start, stop, cancel, clearError };
}
