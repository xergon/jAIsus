'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from '@/lib/toast';
import { VOICE_OPTIONS } from '@/lib/constants';

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

// Voices picked in Settings, per personality. 'jaisus-voice-id' is rewritten
// from the personality on every load and switch, so the choice is kept here.
const VOICE_OVERRIDES_KEY = 'jaisus-voice-overrides';

function readVoiceOverrides(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(VOICE_OVERRIDES_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** The voice picked in Settings for this personality, if it is still offered. */
export function getVoiceOverride(personalityId: string): string | null {
  if (typeof window === 'undefined') return null;
  const id = readVoiceOverrides()[personalityId];
  return typeof id === 'string' && VOICE_OPTIONS.some(v => v.id === id) ? id : null;
}

/** null removes the override, so the personality's own voice applies again. */
export function setVoiceOverride(personalityId: string, voiceId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    const overrides = readVoiceOverrides();
    if (voiceId) overrides[personalityId] = voiceId;
    else delete overrides[personalityId];
    localStorage.setItem(VOICE_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch { /* */ }
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

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
// touchstart is not a user-activation event (touchend and click are), so iOS
// can refuse a play() started from it.
const UNLOCK_EVENTS = ['touchend', 'click', 'keydown'];

function markAudioUnlocked() {
  audioUnlocked = true;
  UNLOCK_EVENTS.forEach(e => document.removeEventListener(e, unlockAudio, true));
}

// Retried on every gesture until the warm element has actually played once.
function unlockAudio() {
  if (audioUnlocked) return;

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
    // Already playing speech: it is unlocked, and loading the silent clip
    // would cut the speech off.
    if (!audio.paused) {
      markAudioUnlocked();
      return;
    }
    audio.src = SILENT_WAV;
    audio.volume = 0.01;
    audio.play().then(() => {
      // Speech may have taken the element over in the meantime.
      if (audio.src === SILENT_WAV) audio.pause();
      audio.volume = 1.0;
      markAudioUnlocked();
      console.log('Audio element unlocked successfully');
    }).catch(() => {
      audio.volume = 1.0;
    });
  } catch {
    // Ignore
  }
}

// Set up unlock listeners once per browser session (NOT once per module load).
// The `window.__jaisusAudioUnlockBound` guard prevents HMR / module
// re-evaluation from re-attaching duplicate listeners. They are removed once
// an unlock succeeds.
if (typeof window !== 'undefined') {
  const w = window as unknown as { __jaisusAudioUnlockBound?: boolean };
  if (!w.__jaisusAudioUnlockBound) {
    w.__jaisusAudioUnlockBound = true;
    UNLOCK_EVENTS.forEach(e =>
      document.addEventListener(e, unlockAudio, { capture: true, passive: true })
    );
  }
}

// The hook instance currently playing through warmAudio (ChatInterface's or
// ParableReader's). A new player stops the old one, so two instances never
// fight over the shared element.
let warmAudioOwner: { id: object; stop: () => void } | null = null;

// Shown once per page load, so an ElevenLabs outage doesn't toast every reply.
let premiumVoiceDownNotified = false;
function notifyPremiumVoiceDown() {
  if (premiumVoiceDownNotified) return;
  premiumVoiceDownNotified = true;
  toast.info("The premium voice isn't available right now, so your device's voice is reading instead.");
}

/** How a clip ended: played through, couldn't play, gave up waiting, or stop() was called. */
type PlayResult = 'ended' | 'failed' | 'timeout' | 'stopped';

interface SpeechChunk {
  text: string;
  /** Started once the chunk is next in line, so it downloads while the one before it plays. */
  audio: Promise<Blob | null> | null;
  /** If this chunk's audio fails, the browser voice reads this text instead. */
  fallbackText?: string;
}

export function useSpeechSynthesis(): SpeechSynthesisResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Shared by every TTS fetch until the next stop(), so stop() cancels both the
  // chunk playing and the one being prefetched.
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<SpeechChunk[]>([]);
  const queueActiveRef = useRef(false);
  const streamDoneRef = useRef(false);
  // Audit fix: playback generation counter so a stop() during an in-flight
  // playBlob can short-circuit the pending promise immediately rather
  // than waiting for the 30s safety timeout. Every stop() bumps it.
  const playbackGenRef = useRef(0);
  // Refs to currently-pending playBlob resolvers so stop() can
  // force-resolve them. Multiple may be queued (queueActiveRef serializes
  // but the audio.onended callback can race with stop()).
  const pendingResolversRef = useRef<Set<() => void>>(new Set());
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
    // Bump playback generation FIRST so any in-flight playBlob
    // detects the cancellation on its next checkpoint.
    playbackGenRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    // Clear the sentence queue
    queueRef.current = [];
    streamDoneRef.current = true;
    queueActiveRef.current = false;
    const ownedAudio = warmAudioOwner?.id === playbackGenRef;
    if (ownedAudio) warmAudioOwner = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      // Do NOT clear src — preserves warm audio's autoplay privilege
      audioRef.current = null;
    }
    // Force-resolve every pending playBlob promise so processQueue
    // exits the await immediately instead of waiting for the 30s safety
    // timeout (audit fix).
    const pending = Array.from(pendingResolversRef.current);
    pendingResolversRef.current.clear();
    for (const resolve of pending) {
      try { resolve(); } catch { /* */ }
    }
    // Revoke ALL outstanding blob URLs to prevent leaks
    activeBlobUrlsRef.current.forEach(url => {
      try { URL.revokeObjectURL(url); } catch { /* */ }
    });
    activeBlobUrlsRef.current.clear();
    // Also stop browser TTS, unless another instance is the one speaking
    if ((ownedAudio || !warmAudioOwner) && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  // Stop everything on unmount — prevents fetches, audio playback, and
  // setIsSpeaking calls from continuing after the component is gone.
  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  // --- Chunk queue ---
  // Streamed replies arrive sentence by sentence (queueSentence) and longer
  // texts are split into chunks (speak); both play here one chunk at a time.
  // Much lower latency than waiting for the full response.

  // Fetches one chunk of speech; null when ElevenLabs fails or returns nothing.
  const fetchAudio = useCallback(async (text: string): Promise<Blob | null> => {
    const controller = abortRef.current ?? (abortRef.current = new AbortController());
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId: getStoredVoiceId() }),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn('TTS API returned', response.status);
        return null;
      }
      const blob = await response.blob();
      return blob.size < 100 ? null : blob;
    } catch {
      return null; // aborted by stop(), or network error
    }
  }, []);

  // Starts downloading the next chunk in line while the current one plays.
  // eleven_v3 voices take 2-3 s per sentence; without this lookahead each
  // sentence would wait for the previous one to finish playing.
  const prefetchNext = useCallback(() => {
    const next = queueRef.current[0];
    if (next && !next.audio) next.audio = fetchAudio(next.text);
  }, [fetchAudio]);

  const playBlob = useCallback((blob: Blob, myGen: number): Promise<PlayResult> => {
    const blobUrl = URL.createObjectURL(blob);
    trackBlobUrl(blobUrl);
    return new Promise<PlayResult>((resolve) => {
      let resolved = false;
      let safetyTimeout: ReturnType<typeof setTimeout> | undefined;
      // Register a force-stop hook so stop() can short-circuit this promise
      // synchronously rather than waiting on the 30s safety timeout.
      const forceStop = () => done('stopped');
      pendingResolversRef.current.add(forceStop);
      const done = (result: PlayResult) => {
        if (resolved) return;
        resolved = true;
        pendingResolversRef.current.delete(forceStop);
        clearTimeout(safetyTimeout);
        // Delay blob revocation so stale events don't fire errors on the audio element
        setTimeout(() => releaseBlobUrl(blobUrl), 500);
        audioRef.current = null;
        resolve(result);
      };

      // If stop() already fired during the awaits above, resolve immediately.
      if (myGen !== playbackGenRef.current) {
        done('stopped');
        return;
      }

      // Safety: if the clip never ends, give up on it. A clip paused from
      // outside the page (lock screen, a phone call) never fires 'ended', so
      // pause it here, or it could be resumed on top of what plays next and
      // stop() couldn't reach it. A long clip still playing gets more time.
      let lastTime = -1;
      const checkStalled = () => {
        const el = audioRef.current;
        if (el && !el.paused && el.currentTime > lastTime) {
          lastTime = el.currentTime;
          safetyTimeout = setTimeout(checkStalled, 30000);
          return;
        }
        try { el?.pause(); } catch { /* */ }
        done('timeout');
      };
      safetyTimeout = setTimeout(checkStalled, 30000);

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
      audio.onended = () => done('ended');
      audio.onerror = () => done('failed');

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
        fb.onended = () => done('ended');
        fb.onerror = () => done('failed');
        fb.play().catch(() => done('failed'));
      });
    });
  }, [trackBlobUrl, releaseBlobUrl]);

  const processQueue = useCallback(async () => {
    if (queueActiveRef.current) {
      console.log('processQueue: already active, skipping');
      return;
    }
    if (warmAudioOwner && warmAudioOwner.id !== playbackGenRef) warmAudioOwner.stop();
    warmAudioOwner = { id: playbackGenRef, stop };
    queueActiveRef.current = true;
    setIsSpeaking(true);
    console.log('processQueue: started');
    // Snapshot generation so stop() bumps it and we exit on next loop iteration.
    const myGen = playbackGenRef.current;
    const cancelled = () => myGen !== playbackGenRef.current;
    // Reads text with the browser voice; stop() ends it like any other chunk.
    const speakBrowser = (text: string) => new Promise<void>((resolve) => {
      const finish = () => {
        pendingResolversRef.current.delete(finish);
        resolve();
      };
      pendingResolversRef.current.add(finish);
      speakWithBrowser(text, finish, cancelled);
    });
    // Once ElevenLabs fails, the rest of this run uses the browser voice
    // rather than switching voices sentence by sentence.
    let premiumDown = false;

    try {
      while (true) {
        // Audit: bail immediately if stop() was called.
        if (cancelled()) {
          console.log('processQueue: stop() bumped generation, exiting');
          break;
        }
        if (queueRef.current.length > 0) {
          const chunk = queueRef.current.shift()!;
          console.log('processQueue: playing sentence:', chunk.text.slice(0, 50));
          let result: PlayResult = 'failed';
          if (!premiumDown) {
            const audio = chunk.audio ?? fetchAudio(chunk.text);
            prefetchNext();
            const blob = await audio;
            if (cancelled()) break;
            if (blob) {
              result = await playBlob(blob, myGen);
            } else {
              premiumDown = true;
              notifyPremiumVoiceDown();
            }
            console.log('processQueue: sentence done:', result);
            if (cancelled()) break;
          }
          // A clip that timed out was paused, not unplayable: don't read it again.
          if (result !== 'failed') continue;
          if (chunk.fallbackText) {
            // ElevenLabs is unavailable: the browser voice reads the whole text.
            queueRef.current = [];
            await speakBrowser(chunk.fallbackText);
            break;
          }
          // Otherwise the browser voice reads this chunk, so a reply is never silent.
          await speakBrowser(chunk.text);
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
      // Audit fix: only clear queueActiveRef + isSpeaking if THIS processQueue
      // is still the active one. Without this guard, a stop() (which bumps
      // generation and sets queueActiveRef=false) followed by a quick new
      // queueSentence (which starts a NEW processQueue) could be undone by
      // the OLD processQueue's finally block running afterward — flipping
      // queueActiveRef back to false while the new processQueue is still
      // running, so the next queueSentence call would spawn a SECOND
      // processQueue and we'd have two queues draining concurrently.
      if (myGen === playbackGenRef.current) {
        queueActiveRef.current = false;
        if (warmAudioOwner?.id === playbackGenRef) warmAudioOwner = null;
        setIsSpeaking(false);
      }
      console.log('processQueue: finished');
    }
  }, [fetchAudio, prefetchNext, playBlob, stop]);

  // Reads a whole text (a parable, the voice test) chunk by chunk, so the voice
  // starts after the first chunk instead of after all of it — eleven_v3 takes
  // ~10 s per 400 characters. If the first chunk fails, the browser voice
  // reads the whole text. No length cap: each chunk is a separate small request,
  // and a cap cut off the end of long teachings.
  const speak = useCallback(async (text: string) => {
    stop();
    unlockAudio();
    const chunks = chunkForSpeech(text);
    if (chunks.length === 0) return;
    queueRef.current = chunks.map((chunk, i) => ({
      text: chunk,
      audio: null,
      fallbackText: i === 0 ? text : undefined,
    }));
    streamDoneRef.current = true;
    await processQueue();
  }, [stop, processQueue]);

  // No dedup here: a reply can repeat a sentence on purpose ("Believe me.").
  const queueSentence = useCallback((sentence: string | null) => {
    if (sentence === null) {
      // Signal end of stream
      streamDoneRef.current = true;
      return;
    }
    const trimmed = sentence.trim();
    if (!trimmed) return;
    queueRef.current.push({ text: trimmed, audio: null });
    // More may follow until queueSentence(null). Also when the queue is still
    // draining the previous reply, which had already signalled its end: the
    // queue must not finish in the middle of this one.
    streamDoneRef.current = false;
    // Start processing if not already running
    if (!queueActiveRef.current) {
      processQueue();
    } else {
      prefetchNext();
    }
  }, [processQueue, prefetchNext]);

  return { speak, queueSentence, stop, isSpeaking };
}

/**
 * Splits text for speaking: the opening sentences on their own (at least ~60
 * characters) so the voice starts quickly, then sentences grouped into chunks
 * of up to ~220 characters.
 */
function chunkForSpeech(text: string): string[] {
  const sentences = (text.match(/[^.!?]+(?:[.!?]+["'”’)]*|$)/g) ?? [])
    .map(s => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const i = chunks.length - 1;
    const fits = i === 0
      ? chunks[0].length < 60
      : i > 0 && chunks[i].length + sentence.length < 220;
    if (fits) chunks[i] += ' ' + sentence;
    else chunks.push(sentence);
  }
  return chunks;
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

// The utterance being spoken. Chrome can garbage-collect an utterance nothing
// references and then never fire its end event.
let currentUtterance: SpeechSynthesisUtterance | null = null;

/**
 * Reads text with the browser voice, sentence by sentence. isCancelled() is
 * checked before each sentence: cancel() fires end/error on the current
 * utterance, which would otherwise just move on to the next sentence.
 */
function speakWithBrowser(text: string, onEnd: () => void, isCancelled: () => boolean) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    onEnd();
    return;
  }

  let finished = false;
  let mine: SpeechSynthesisUtterance | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    if (currentUtterance === mine) currentUtterance = null;
    onEnd();
  };
  // Some browsers never fire end or error (iOS can ignore a speak() made
  // outside a tap), which would leave the queue waiting forever.
  const watchdog = setTimeout(() => {
    if (!isCancelled()) window.speechSynthesis.cancel();
    finish();
  }, text.length * 120 + 5000);

  window.speechSynthesis.cancel();

  // Chrome sometimes needs a tiny delay after cancel
  setTimeout(() => {
    if (isCancelled()) {
      finish();
      return;
    }
    // Split into sentences to avoid Chrome's 15s cutoff; keeps a final
    // fragment that has no closing punctuation.
    const sentences = (text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [])
      .map(s => s.trim())
      .filter(Boolean);
    let index = 0;

    const voices = window.speechSynthesis.getVoices();
    const bestVoice = pickBestVoice(voices);
    if (bestVoice) {
      console.log('Using TTS voice:', bestVoice.name, bestVoice.lang);
    }

    function speakNext() {
      if (isCancelled() || index >= sentences.length) {
        finish();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(sentences[index]);
      utterance.rate = 0.88;
      utterance.pitch = 0.85;
      utterance.volume = 1.0;

      if (bestVoice) utterance.voice = bestVoice;

      utterance.onend = () => {
        index++;
        speakNext();
      };

      utterance.onerror = (e) => {
        if (!isCancelled()) console.warn('Browser TTS error:', e);
        // Try next sentence instead of giving up entirely
        index++;
        speakNext();
      };

      mine = utterance;
      currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    }

    speakNext();
  }, 100);
}
