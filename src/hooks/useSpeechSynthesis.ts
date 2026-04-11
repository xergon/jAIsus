'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface SpeechSynthesisResult {
  speak: (text: string) => Promise<void>;
  stop: () => void;
  isSpeaking: boolean;
}

/**
 * Audio unlock: Mobile browsers block programmatic audio playback unless
 * there's been at least one user-gesture-triggered play(). We create a
 * silent Audio element on the first user touch/click to "unlock" the audio context.
 */
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  // Play a silent audio to unlock the audio context
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    ctx.resume().catch(() => {});
  } catch {
    // Ignore — best effort
  }

  // Also try an Audio element
  try {
    const audio = new Audio();
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audio.volume = 0.01;
    audio.play().then(() => audio.pause()).catch(() => {});
  } catch {
    // Ignore
  }
}

// Set up unlock listeners once
if (typeof window !== 'undefined') {
  const events = ['touchstart', 'touchend', 'click', 'keydown'];
  function onFirstInteraction() {
    unlockAudio();
    events.forEach(e => document.removeEventListener(e, onFirstInteraction, true));
  }
  events.forEach(e => document.addEventListener(e, onFirstInteraction, { capture: true, once: false, passive: true }));
}

export function useSpeechSynthesis(): SpeechSynthesisResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Pre-load browser voices (needed on some browsers)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      // Chrome loads voices async
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    // Also stop browser TTS
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string) => {
    stop();

    // Ensure audio is unlocked
    unlockAudio();

    const controller = new AbortController();
    abortRef.current = controller;

    setIsSpeaking(true);

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 2000) }), // Limit text length
        signal: controller.signal,
      });

      if (!response.ok) {
        console.warn('TTS API returned', response.status, '— falling back to browser TTS');
        speakWithBrowser(text, () => setIsSpeaking(false));
        return;
      }

      const blob = await response.blob();
      if (blob.size < 100) {
        // Too small to be real audio
        console.warn('TTS response too small, falling back to browser');
        speakWithBrowser(text, () => setIsSpeaking(false));
        return;
      }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      // Set volume explicitly
      audio.volume = 1.0;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        audioRef.current = null;
      };

      audio.onerror = (e) => {
        console.warn('Audio playback error:', e);
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        audioRef.current = null;
        speakWithBrowser(text, () => setIsSpeaking(false));
      };

      await audio.play();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.warn('TTS error, falling back to browser:', err);
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

  // Chrome sometimes needs a tiny delay after cancel
  setTimeout(() => {
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
      utterance.volume = 1.0;

      // Try to find a deep male voice
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v =>
        v.name.includes('Daniel') ||
        v.name.includes('James') ||
        v.name.includes('Aaron') ||
        v.name.includes('Google UK English Male')
      );
      if (preferred) utterance.voice = preferred;

      utterance.onend = () => {
        index++;
        speakNext();
      };

      utterance.onerror = (e) => {
        console.warn('Browser TTS error:', e);
        onEnd();
      };

      window.speechSynthesis.speak(utterance);
    }

    speakNext();
  }, 100);
}
