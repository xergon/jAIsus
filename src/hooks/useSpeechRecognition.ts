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

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

interface SpeechRecognitionResult {
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
): SpeechRecognitionResult {
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
    const supported = typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
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

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('');
      setInterimTranscript('');
      setError(null);
    };

    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (finalText) {
        clearSilenceTimer();
        lastInterimRef.current = '';
        setTranscript(finalText);
        setInterimTranscript('');
        onResultRef.current?.(finalText);
      } else {
        setInterimTranscript(interim);
        lastInterimRef.current = interim;

        // Custom silence timeout: if no new results for 1.2s, force-submit
        // the interim text. Much faster than the browser's default ~3-4s.
        clearSilenceTimer();
        if (interim.trim().length > 0) {
          silenceTimerRef.current = setTimeout(() => {
            const text = lastInterimRef.current.trim();
            if (text) {
              lastInterimRef.current = '';
              setTranscript(text);
              setInterimTranscript('');
              onResultRef.current?.(text);
              // Stop recognition since we're submitting
              try { recognition.stop(); } catch { /* */ }
            }
          }, 1200);
        }
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
