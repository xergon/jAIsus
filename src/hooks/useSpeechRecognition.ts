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
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInterimRef = useRef<string>('');

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

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearSilenceTimer();
    try {
      recognitionRef.current?.stop();
    } catch {
      // May throw if already stopped
    }
    setIsListening(false);
    setInterimTranscript('');
    lastInterimRef.current = '';
  }, [clearSilenceTimer]);

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

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('');
      setInterimTranscript('');
      setError(null);
    };

    // Accumulate all text across continuous recognition results
    let fullText = '';

    recognition.onresult = (event) => {
      // Rebuild fullText from ALL results (finals + latest interim)
      let rebuilt = '';
      let latestInterim = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          rebuilt += event.results[i][0].transcript;
        } else {
          latestInterim += event.results[i][0].transcript;
        }
      }
      fullText = (rebuilt + latestInterim).trim();

      setInterimTranscript(fullText);
      lastInterimRef.current = fullText;

      // Reset silence timer on every new result — submit after 2s of silence.
      clearSilenceTimer();
      if (fullText.length > 0) {
        silenceTimerRef.current = setTimeout(() => {
          const text = lastInterimRef.current.trim();
          if (text) {
            console.log('Speech recognition submitting:', text);
            lastInterimRef.current = '';
            fullText = '';
            setTranscript(text);
            setInterimTranscript('');
            onResultRef.current?.(text);
            try { recognition.stop(); } catch { /* */ }
          }
        }, 2000);
      }
    };

    recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
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
      clearSilenceTimer();
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch (err) {
      console.warn('Failed to start recognition:', err);
      setError('Failed to start speech recognition. Please try again.');
      setIsListening(false);
    }
  }, [isSupported, clearSilenceTimer]);

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore
      }
    };
  }, [clearSilenceTimer]);

  return { transcript, interimTranscript, isListening, isSupported, error, start, stop };
}
