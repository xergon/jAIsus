'use client';

import { useState, useCallback, useRef } from 'react';

interface SpeechSynthesisResult {
  speak: (text: string) => Promise<void>;
  stop: () => void;
  isSpeaking: boolean;
}

export function useSpeechSynthesis(): SpeechSynthesisResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string) => {
    stop();

    const controller = new AbortController();
    abortRef.current = controller;

    setIsSpeaking(true);

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Fallback to browser TTS
        speakWithBrowser(text, () => setIsSpeaking(false));
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        audioRef.current = null;
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        audioRef.current = null;
        // Fallback to browser TTS on audio error
        speakWithBrowser(text, () => setIsSpeaking(false));
      };

      await audio.play();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('TTS error, falling back to browser:', err);
      speakWithBrowser(text, () => setIsSpeaking(false));
    }
  }, [stop]);

  return { speak, stop, isSpeaking };
}

function speakWithBrowser(text: string, onEnd: () => void) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    onEnd();
    return;
  }

  window.speechSynthesis.cancel();

  // Split into sentences to avoid Chrome's 15s cutoff
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let index = 0;

  function speakNext() {
    if (index >= sentences.length) {
      onEnd();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(sentences[index].trim());
    utterance.rate = 0.85;
    utterance.pitch = 0.9;

    // Try to find a deep male voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes('Daniel') || v.name.includes('James'));
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => {
      index++;
      speakNext();
    };

    utterance.onerror = () => {
      onEnd();
    };

    window.speechSynthesis.speak(utterance);
  }

  speakNext();
}
