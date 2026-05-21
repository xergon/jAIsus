'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface SpeechSynthesisResult {
  speak: (text: string) => Promise<void>;
  /** Queue a sentence for playback. Call with null to signal end of stream. */
  queueSentence: (sentence: string | null) => void;
  stop: () => void;
  isSpeaking: boolean;
}

// Voice ID is stored in localStorage so it persists across sessions
function getStoredVoiceId(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem('jaisus-voice-id'); } catch { return null; }
}
export function setStoredVoiceId(id: string) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('jaisus-voice-id', id); } catch { /* */ }
}

/**
 * Audio unlock strategy:
 *
 * Chrome/Safari require a user gesture to start audio playback. We keep a
 * persistent AudioContext and a reusable silent <audio> element. On first
 * user interaction we resume the context and play silence to fully unlock
 * both the Web Audio API and HTMLMediaElement playback paths.
 *
 * We also keep a persistent "warmed up" Audio element that has already
 * called play() during a user gesture — this element can be reused for
 * TTS playback without triggering the autoplay block.
 */
let audioUnlocked = false;
let persistentCtx: AudioContext | null = null;
let warmAudio: HTMLAudioElement | null = null;

function getAudioContext(): AudioContext {
  if (!persistentCtx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    persistentCtx = new AC();
  }
  return persistentCtx;
}

/** Returns a "warm" Audio element that has been unlocked by a user gesture */
function getWarmAudio(): HTMLAudioElement {
  if (!warmAudio) {
    warmAudio = new Audio();
  }
  return warmAudio;
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  // Resume the persistent AudioContext
  try {
    const ctx = getAudioContext();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    ctx.resume().catch(() => {});
  } catch {
    // Ignore — best effort
  }

  // Play silence on the warm Audio element to unlock HTMLMediaElement path.
  // Do NOT clear audio.src afterwards — keeps the autoplay privilege alive.
  try {
    const audio = getWarmAudio();
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audio.volume = 0.01;
    audio.play().then(() => {
      audio.pause();
      audio.volume = 1.0;
      console.log('Audio element unlocked successfully');
    }).catch(() => {});
  } catch {
    // Ignore
  }
}

// Set up unlock listeners once per browser session (NOT once per module load).
//
// Using { once: true } means each listener auto-removes after firing.
// The extra `window.__jaisusAudioUnlockBound` guard prevents HMR / module
// re-evaluation from re-attaching duplicate listeners before the user's
// first interaction fires them. Combined with the `audioUnlocked` guard
// inside unlockAudio(), this is safe even if multiple events fire (e.g.,
// a click triggers both touchstart and click).
if (typeof window !== 'undefined') {
  const w = window as unknown as { __jaisusAudioUnlockBound?: boolean };
  if (!w.__jaisusAudioUnlockBound) {
    w.__jaisusAudioUnlockBound = true;
    const unlockEvents = ['touchstart', 'touchend', 'click', 'keydown'];
    unlockEvents.forEach(e =>
      document.addEventListener(e, unlockAudio, { capture: true, once: true, passive: true })
    );
  }
}

export function useSpeechSynthesis(): SpeechSynthesisResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<string[]>([]);
  const queueActiveRef = useRef(false);
  const streamDoneRef = useRef(false);
  // Track every blob URL we create so we can revoke them all on stop/unmount.
  // Without this, stop() leaves blob URLs orphaned in memory until the next
  // play cycle's onended/onerror fires (which it won't, because handlers are
  // detached on the previous element).
  const activeBlobUrlsRef = useRef<Set<string>>(new Set());

  // Helper: track a blob URL for cleanup
  const trackBlobUrl = useCallback((url: string) => {
    activeBlobUrlsRef.current.add(url);
  }, []);
  const releaseBlobUrl = useCallback((url: string) => {
    if (activeBlobUrlsRef.current.delete(url)) {
      URL.revokeObjectURL(url);
    }
  }, []);

  // Pre-load browser voices (needed on some browsers)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    // Chrome loads voices async — keep a stable handler reference so cleanup
    // doesn't accidentally null someone else's handler
    const onVoicesChanged = () => {
      window.speechSynthesis.getVoices();
    };
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    // Clear the sentence queue
    queueRef.current = [];
    streamDoneRef.current = true;
    queueActiveRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      // Do NOT clear src — preserves warm audio's autoplay privilege
      audioRef.current = null;
    }
    // Revoke ALL outstanding blob URLs to prevent leaks
    activeBlobUrlsRef.current.forEach(url => {
      try { URL.revokeObjectURL(url); } catch { /* */ }
    });
    activeBlobUrlsRef.current.clear();
    // Also stop browser TTS
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  // Stop everything on unmount — prevents fetches, audio playback, and
  // setIsSpeaking calls from continuing after the component is gone.
  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

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
        body: JSON.stringify({ text: text.slice(0, 2000), voiceId: getStoredVoiceId() }), // Limit text length
        signal: controller.signal,
      });

      if (!response.ok) {
        console.warn('TTS API returned', response.status, '— falling back to browser TTS');
        speakWithBrowser(text, () => setIsSpeaking(false));
        return;
      }

      const blob = await response.blob();
      if (blob.size < 100) {
        console.warn('TTS response too small, falling back to browser');
        speakWithBrowser(text, () => setIsSpeaking(false));
        return;
      }

      const blobUrl = URL.createObjectURL(blob);
      trackBlobUrl(blobUrl);

      // Use the warm (gesture-unlocked) audio element. It was play()-ed during
      // a user gesture so Chrome trusts it for autoplay. getWarmAudio() always
      // returns an element (creates one lazily), so no || fallback needed.
      const audio = getWarmAudio();
      audio.src = blobUrl;
      audio.volume = 1.0;
      audioRef.current = audio;

      audio.onended = () => {
        releaseBlobUrl(blobUrl);
        setIsSpeaking(false);
        audioRef.current = null;
      };

      audio.onerror = (e) => {
        console.warn('Audio playback error:', e);
        releaseBlobUrl(blobUrl);
        setIsSpeaking(false);
        audioRef.current = null;
        speakWithBrowser(text, () => setIsSpeaking(false));
      };

      // Resume AudioContext in case it got suspended
      try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
      } catch {
        // non-critical
      }

      try {
        await audio.play();
        console.log('ElevenLabs TTS playing, size:', blob.size);
      } catch (playErr) {
        console.warn('play() blocked, trying with new Audio:', playErr);
        // Fallback: create a fresh Audio element (sometimes works after context resume)
        const fallback = new Audio(blobUrl);
        fallback.volume = 1.0;
        audioRef.current = fallback;
        fallback.onended = () => {
          releaseBlobUrl(blobUrl);
          setIsSpeaking(false);
          audioRef.current = null;
        };
        fallback.onerror = () => {
          releaseBlobUrl(blobUrl);
          setIsSpeaking(false);
          audioRef.current = null;
          speakWithBrowser(text, () => setIsSpeaking(false));
        };
        try {
          await fallback.play();
        } catch {
          console.warn('All audio play attempts failed, falling back to browser TTS');
          releaseBlobUrl(blobUrl);
          speakWithBrowser(text, () => setIsSpeaking(false));
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.warn('TTS error, falling back to browser:', err);
      speakWithBrowser(text, () => setIsSpeaking(false));
    }
  }, [stop, trackBlobUrl, releaseBlobUrl]);

  // --- Sentence queue for streaming TTS ---
  // Plays sentences one by one as they arrive from the AI stream.
  // Much lower latency than waiting for the full response.

  const playOneSentence = useCallback(async (sentence: string): Promise<boolean> => {
    unlockAudio();
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence, voiceId: getStoredVoiceId() }),
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const blob = await response.blob();
      if (blob.size < 100) return false;

      const blobUrl = URL.createObjectURL(blob);
      trackBlobUrl(blobUrl);
      return new Promise<boolean>((resolve) => {
        let resolved = false;
        const done = (ok: boolean) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(safetyTimeout);
          // Delay blob revocation so stale events don't fire errors on the audio element
          setTimeout(() => releaseBlobUrl(blobUrl), 500);
          audioRef.current = null;
          resolve(ok);
        };

        // Safety: if audio never fires onended/onerror, resolve after 30s
        const safetyTimeout = setTimeout(() => done(false), 30000);

        const audio = getWarmAudio();
        // Null out old handlers FIRST — prevents stale events from a previous
        // blob URL from resolving this promise prematurely.
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.src = blobUrl;
        audio.volume = 1.0;
        audioRef.current = audio;

        // Set handlers AFTER src is assigned so only events from this clip resolve
        audio.onended = () => done(true);
        audio.onerror = () => done(false);

        // Resume AudioContext
        try {
          const ctx = getAudioContext();
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        } catch { /* */ }

        audio.play().catch(() => {
          // Try fallback with a fresh element
          const fb = new Audio(blobUrl);
          fb.volume = 1.0;
          audioRef.current = fb;
          fb.onended = () => done(true);
          fb.onerror = () => done(false);
          fb.play().catch(() => done(false));
        });
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return false;
      return false;
    }
  }, [trackBlobUrl, releaseBlobUrl]);

  const processQueue = useCallback(async () => {
    if (queueActiveRef.current) {
      console.log('processQueue: already active, skipping');
      return;
    }
    queueActiveRef.current = true;
    setIsSpeaking(true);
    console.log('processQueue: started');

    try {
      while (true) {
        if (queueRef.current.length > 0) {
          const sentence = queueRef.current.shift()!;
          console.log('processQueue: playing sentence:', sentence.slice(0, 50));
          const ok = await playOneSentence(sentence);
          console.log('processQueue: sentence done, ok:', ok);
        } else if (streamDoneRef.current) {
          console.log('processQueue: stream done, exiting');
          break;
        } else {
          await new Promise(r => setTimeout(r, 100));
        }
      }
    } catch (err) {
      console.warn('processQueue error:', err);
    } finally {
      queueActiveRef.current = false;
      setIsSpeaking(false);
      console.log('processQueue: finished');
    }
  }, [playOneSentence]);

  const lastQueuedRef = useRef<string>('');

  const queueSentence = useCallback((sentence: string | null) => {
    if (sentence === null) {
      // Signal end of stream
      streamDoneRef.current = true;
      lastQueuedRef.current = '';
      return;
    }
    const trimmed = sentence.trim();
    if (!trimmed) return;
    // Dedup: skip if this exact sentence was just queued (covers race conditions)
    if (trimmed === lastQueuedRef.current) return;
    lastQueuedRef.current = trimmed;
    queueRef.current.push(trimmed);
    // Start processing if not already running
    if (!queueActiveRef.current) {
      streamDoneRef.current = false;
      processQueue();
    }
  }, [processQueue]);

  return { speak, queueSentence, stop, isSpeaking };
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
