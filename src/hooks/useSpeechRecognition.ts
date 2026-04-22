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

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface WindowWithSpeech {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

interface SpeechRecognitionHookResult {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  isSupported: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useSpeechRecognition(
  onResult?: (transcript: string) => void
): SpeechRecognitionHookResult {
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onResultRef = useRef(onResult);
  const lastInterimRef = useRef<string>('');
  const submittedRef = useRef(false);

  // Keep onResult ref updated without causing re-renders
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const w = window as unknown as WindowWithSpeech;
    const supported = typeof window !== 'undefined' &&
      (!!w.SpeechRecognition || !!w.webkitSpeechRecognition);
    setIsSupported(supported);
  }, []);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // May throw if already stopped
    }
    setIsListening(false);
    setInterimTranscript('');
    lastInterimRef.current = '';
  }, []);

  const start = useCallback(() => {
    if (!isSupported) {
      setError('Speech recognition is not supported in this browser');
      return;
    }

    // Stop any existing recognition
    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore
    }

    setError(null);

    const w = window as unknown as WindowWithSpeech;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognition) { setError('Speech recognition not available'); return; }
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    // continuous = true: we manage end-of-speech via a silence timeout.
    // This prevents Chrome from cutting off mid-sentence on brief pauses.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    submittedRef.current = false;

    // Silence timeout: submit after 2s of no new speech activity
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let accumulatedText = '';

    function resetSilenceTimer() {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        // 2s of silence — submit what we have and stop
        if (!submittedRef.current && accumulatedText.trim()) {
          submittedRef.current = true;
          const text = accumulatedText.trim();
          console.log('Speech silence timeout submit:', text);
          setTranscript(text);
          setInterimTranscript('');
          lastInterimRef.current = '';
          onResultRef.current?.(text);
        }
        try { recognition.stop(); } catch { /* */ }
      }, 2000);
    }

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('');
      setInterimTranscript('');
      setError(null);
      accumulatedText = '';
      resetSilenceTimer();
    };

    recognition.onresult = (event) => {
      if (submittedRef.current) return;

      // Rebuild full transcript from all results
      let full = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          full += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      accumulatedText = full + interim;
      setInterimTranscript(accumulatedText);
      lastInterimRef.current = accumulatedText;

      // Reset silence timer — user is still talking
      resetSilenceTimer();
    };

    recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      if (silenceTimer) clearTimeout(silenceTimer);
      if (event.error === 'not-allowed') {
        setError('Microphone access denied. Please allow microphone access in your browser settings.');
      } else if (event.error === 'no-speech') {
        setError('No speech detected. Try again.');
      } else if (event.error !== 'aborted') {
        setError(`Recognition error: ${event.error}`);
      }
      setIsListening(false);
      setInterimTranscript('');
    };

    recognition.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      // If recognition ended without submitting, submit whatever we have
      if (!submittedRef.current && accumulatedText.trim()) {
        const text = accumulatedText.trim();
        console.log('Speech onend fallback submit:', text);
        submittedRef.current = true;
        lastInterimRef.current = '';
        setTranscript(text);
        setInterimTranscript('');
        onResultRef.current?.(text);
      }
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch (err) {
      console.warn('Failed to start recognition:', err);
      setError('Failed to start speech recognition. Please try again.');
      setIsListening(false);
    }
  }, [isSupported]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore
      }
    };
  }, []);

  return { transcript, interimTranscript, isListening, isSupported, error, start, stop };
}
