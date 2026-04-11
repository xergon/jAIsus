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

/**
 * Picks the best available voice for a warm, authoritative male sound.
 * Priority order (highest first):
 *  1. Premium/Enhanced macOS voices (Daniel Premium, Aaron, etc.)
 *  2. Google high-quality voices (UK English Male)
 *  3. Standard platform voices (Daniel, James, Fred)
 *  4. Any English male voice
 *  5. Any English voice
 *  6. Default voice
 */
function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  const englishVoices = voices.filter(v =>
    v.lang.startsWith('en')
  );

  // Tier 1: Premium / Enhanced voices (macOS "Premium" or "Enhanced" variants)
  const premium = englishVoices.find(v =>
    /\b(Premium|Enhanced)\b/i.test(v.name) &&
    /\b(Daniel|Aaron|James|Tom|Oliver)\b/i.test(v.name)
  );
  if (premium) return premium;

  // Tier 2: Google high-quality voices
  const googleMale = englishVoices.find(v =>
    v.name.includes('Google UK English Male')
  );
  if (googleMale) return googleMale;

  const googleUS = englishVoices.find(v =>
    v.name.includes('Google US English')
  );
  if (googleUS) return googleUS;

  // Tier 3: Well-known platform voices by name
  const knownGood = ['Daniel', 'James', 'Aaron', 'Tom', 'Oliver', 'Arthur'];
  for (const name of knownGood) {
    const match = englishVoices.find(v => v.name.includes(name));
    if (match) return match;
  }

  // Tier 4: Any English voice that sounds male (heuristic — lower pitch range)
  // Just pick the first en-GB or en-US voice as a reasonable fallback
  const enGB = englishVoices.find(v => v.lang === 'en-GB');
  if (enGB) return enGB;

  const enUS = englishVoices.find(v => v.lang === 'en-US');
  if (enUS) return enUS;

  // Tier 5: Any English voice at all
  if (englishVoices.length > 0) return englishVoices[0];

  // Tier 6: Whatever is available
  return voices[0];
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

    const voices = window.speechSynthesis.getVoices();
    const bestVoice = pickBestVoice(voices);
    if (bestVoice) {
      console.log('Using TTS voice:', bestVoice.name, bestVoice.lang);
    }

    function speakNext() {
      if (index >= sentences.length) {
        onEnd();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(sentences[index].trim());
      utterance.rate = 0.88;
      utterance.pitch = 0.85;
      utterance.volume = 1.0;

      if (bestVoice) utterance.voice = bestVoice;

      utterance.onend = () => {
        index++;
        speakNext();
      };

      utterance.onerror = (e) => {
        console.warn('Browser TTS error:', e);
        // Try next sentence instead of giving up entirely
        index++;
        if (index < sentences.length) {
          speakNext();
        } else {
          onEnd();
        }
      };

      window.speechSynthesis.speak(utterance);
    }

    speakNext();
  }, 100);
}
