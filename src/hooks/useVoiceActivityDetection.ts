'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Voice Activity Detection (VAD) — passive mic listening that fires callbacks
 * when the user starts/stops speaking. Used to implement "barge-in" so the
 * user can interrupt TTS by simply talking, like a real conversation.
 *
 * Privacy / cost considerations:
 *  - The hook is fully dormant when `enabled` is false. No AudioContext, no
 *    mic stream, no rAF loop. It does not request permission until the caller
 *    flips `enabled` to true. The caller owns the consent gate.
 *  - We do not record or stream audio anywhere — RMS amplitude is computed
 *    locally and only the boolean "is speaking?" signal escapes via callbacks.
 *  - We do NOT connect the analyser to the destination, so the mic is never
 *    echoed back through the speakers (which would also feed TTS back into VAD).
 *
 * Algorithm:
 *  1. fftSize = 2048; sample byte time-domain data each rAF.
 *  2. RMS amplitude on the [-1, 1] centered signal.
 *  3. Rising edge: RMS > threshold sustained for `minSpeechMs` → onSpeechStart.
 *  4. Falling edge: RMS < threshold sustained for `SILENCE_MS` → onSpeechEnd.
 *  5. After firing onSpeechStart, we won't fire again until a falling edge
 *     resets the flag — this prevents repeat firing during one utterance.
 */

export interface UseVADOptions {
  /** When false, the hook is fully dormant — no mic, no audio context. */
  enabled: boolean;
  /** Called when voice activity is detected over `threshold` for `minSpeechMs`. */
  onSpeechStart: () => void;
  /** Optional — called when activity drops below threshold for `SILENCE_MS`. */
  onSpeechEnd?: () => void;
  /** RMS amplitude threshold for "speaking". Default 0.02 (calibrated for typical voice). */
  threshold?: number;
  /** ms of sustained activity before firing onSpeechStart. Default 150. */
  minSpeechMs?: number;
}

export interface UseVADResult {
  /** True if VAD is actively monitoring the mic */
  isMonitoring: boolean;
  /** True if speech is currently detected */
  isSpeaking: boolean;
  /** Last error (e.g., permission denied) */
  error: string | null;
  /** True if browser supports the required APIs */
  isSupported: boolean;
}

/** How long RMS must stay below `threshold` before we call onSpeechEnd. */
const SILENCE_MS = 400;

interface AudioContextCtor {
  new (): AudioContext;
}

interface WindowWithWebkitAC extends Window {
  webkitAudioContext?: AudioContextCtor;
}

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const w = window as WindowWithWebkitAC;
  return w.webkitAudioContext ?? null;
}

export function useVoiceActivityDetection(options: UseVADOptions): UseVADResult {
  const {
    enabled,
    onSpeechStart,
    onSpeechEnd,
    threshold = 0.02,
    minSpeechMs = 150,
  } = options;

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  // All timing / audio refs — these MUST NOT trigger re-renders on every frame.
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bufferRef = useRef<Uint8Array | null>(null);
  const rafRef = useRef<number | null>(null);

  // Edge-detection refs (frame-loop state).
  const aboveSinceRef = useRef<number | null>(null);   // timestamp RMS first crossed threshold
  const belowSinceRef = useRef<number | null>(null);   // timestamp RMS first dropped below
  const firedRef = useRef(false);                       // onSpeechStart fired for current utterance

  // Stable callback refs — avoids re-running the heavy setup effect when the
  // parent passes inline functions that change identity each render.
  const onStartRef = useRef(onSpeechStart);
  const onEndRef = useRef(onSpeechEnd);
  useEffect(() => { onStartRef.current = onSpeechStart; }, [onSpeechStart]);
  useEffect(() => { onEndRef.current = onSpeechEnd; }, [onSpeechEnd]);

  // Detect support once on mount.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      setIsSupported(false);
      return;
    }
    const hasMedia = !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
    const hasAC = !!getAudioContextCtor();
    setIsSupported(hasMedia && hasAC);
  }, []);

  // Main effect: spin up/tear down everything based on `enabled`.
  // We intentionally don't depend on threshold/minSpeechMs — those are read
  // through closure references (refs below) so they can change without
  // reinitializing the mic.
  const thresholdRef = useRef(threshold);
  const minSpeechMsRef = useRef(minSpeechMs);
  useEffect(() => { thresholdRef.current = threshold; }, [threshold]);
  useEffect(() => { minSpeechMsRef.current = minSpeechMs; }, [minSpeechMs]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    const AC = getAudioContextCtor();
    if (!AC || !navigator.mediaDevices?.getUserMedia) {
      setError('Voice activity detection is not supported in this browser');
      return;
    }

    // Generation guard — if the caller flips `enabled` off (or unmounts)
    // while getUserMedia is still pending, we must NOT install the stream.
    let cancelled = false;

    async function init() {
      try {
        setError(null);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        // AC is non-null here — checked above before entering init().
        const ctx = new AC!();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.4;

        // source → analyser only. Do NOT connect to ctx.destination — we do
        // not want to echo the mic back to the speakers (would also create
        // a feedback loop with TTS).
        source.connect(analyser);

        const buffer = new Uint8Array(analyser.fftSize);

        streamRef.current = stream;
        audioCtxRef.current = ctx;
        sourceRef.current = source;
        analyserRef.current = analyser;
        bufferRef.current = buffer;

        // Reset edge-detection state for a fresh session.
        aboveSinceRef.current = null;
        belowSinceRef.current = null;
        firedRef.current = false;

        setIsMonitoring(true);

        const tick = () => {
          const a = analyserRef.current;
          const buf = bufferRef.current;
          if (!a || !buf) return;
          // Cast for older lib.dom typings that expect ArrayBufferView<ArrayBuffer>.
          a.getByteTimeDomainData(buf as unknown as Uint8Array<ArrayBuffer>);

          // RMS of (sample - 128) / 128 — bytes are centered at 128.
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / buf.length);

          const now = performance.now();
          const thr = thresholdRef.current;
          const minMs = minSpeechMsRef.current;

          if (rms > thr) {
            belowSinceRef.current = null;
            if (aboveSinceRef.current == null) aboveSinceRef.current = now;
            // Rising edge: sustained above threshold for at least minSpeechMs.
            if (!firedRef.current && now - aboveSinceRef.current >= minMs) {
              firedRef.current = true;
              setIsSpeaking(true);
              try { onStartRef.current?.(); } catch (e) { console.warn('VAD onSpeechStart threw:', e); }
            }
          } else {
            aboveSinceRef.current = null;
            if (belowSinceRef.current == null) belowSinceRef.current = now;
            // Falling edge: sustained below threshold for SILENCE_MS.
            if (firedRef.current && now - belowSinceRef.current >= SILENCE_MS) {
              firedRef.current = false;
              setIsSpeaking(false);
              try { onEndRef.current?.(); } catch (e) { console.warn('VAD onSpeechEnd threw:', e); }
            }
          }

          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        const name = (err as Error)?.name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setError('Microphone access denied. You can enable it in your browser settings.');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setError('No microphone found.');
        } else {
          setError('Could not start voice activity detection.');
        }
        setIsMonitoring(false);
      }
    }

    init();

    return () => {
      cancelled = true;

      // Stop the rAF loop first so we don't read freed buffers.
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      // Disconnect analyser graph.
      try { sourceRef.current?.disconnect(); } catch { /* */ }
      try { analyserRef.current?.disconnect(); } catch { /* */ }

      // Close the AudioContext to release the audio worklet thread.
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => { /* */ });
      }

      // Stop mic tracks — releases the OS recording indicator.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      // Clear refs so a subsequent enable starts from a clean slate.
      streamRef.current = null;
      audioCtxRef.current = null;
      sourceRef.current = null;
      analyserRef.current = null;
      bufferRef.current = null;
      aboveSinceRef.current = null;
      belowSinceRef.current = null;
      firedRef.current = false;

      setIsMonitoring(false);
      setIsSpeaking(false);
    };
  }, [enabled]);

  return { isMonitoring, isSpeaking, error, isSupported };
}
