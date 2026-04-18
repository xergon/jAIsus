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

    // continuous = false: browser handles end-of-speech detection naturally.
    // This is the most reliable mode across browsers and mobile.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    submittedRef.current = false;

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

      if (finalText && !submittedRef.current) {
        // Browser decided the utterance is complete — submit immediately
        submittedRef.current = true;
        lastInterimRef.current = '';
        setTranscript(finalText);
        setInterimTranscript('');
        console.log('Speech final result:', finalText);
        onResultRef.current?.(finalText);
      } else {
        setInterimTranscript(interim);
        lastInterimRef.current = interim;
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
      // If recognition ended without a final result (e.g., browser timeout),
      // submit whatever interim text we have as a fallback.
      if (!submittedRef.current && lastInterimRef.current.trim()) {
        const text = lastInterimRef.current.trim();
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
