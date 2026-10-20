'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Long-form audio recorder built on MediaRecorder + Web Audio API.
 *
 * Returns a Blob (webm/opus when supported, falling back to whatever the
 * browser will record) plus a live amplitude level for animating a meter
 * during recording, plus elapsed time. Stops automatically when the user
 * hits `maxDurationSec` so we never produce a file the server will reject.
 *
 * Lifecycle is generation-counter-guarded (same pattern as useCamera) so
 * rapid start/stop while getUserMedia is pending doesn't leak a stream.
 */

export interface UseAudioRecorderOptions {
  /** Auto-stop after this many seconds. Default 300 (5 min). */
  maxDurationSec?: number;
  /** Called when the recording finishes (manually or by max-duration). */
  onComplete?: (result: { blob: Blob; mimeType: string; durationSec: number }) => void;
  /** Called on permission denial or unsupported environment. */
  onError?: (error: string) => void;
}

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopping';

/** 3 MB of audio is 4 MB as base64 — under Vercel's 4.5 MB request-body limit for /api/memo. */
const MAX_RECORDING_BYTES = 3_000_000;

export interface UseAudioRecorderResult {
  state: RecorderState;
  /** 0..1 — RMS amplitude updated ~30x per second while recording. */
  level: number;
  /** Seconds elapsed since recording started. */
  elapsedSec: number;
  error: string | null;
  isSupported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    '',
  ];
  for (const m of candidates) {
    if (m === '' || MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export function useAudioRecorder({
  maxDurationSec = 300,
  onComplete,
  onError,
}: UseAudioRecorderOptions = {}): UseAudioRecorderResult {
  const [state, setState] = useState<RecorderState>('idle');
  const [level, setLevel] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startTimeRef = useRef(0);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const cancelledRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  // Keep callback refs fresh without re-creating start/stop.
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Feature detect on mount only.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const ok =
      typeof MediaRecorder !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      (typeof AudioContext !== 'undefined' ||
        typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined');
    setIsSupported(ok);
  }, []);

  const tearDown = useCallback(() => {
    if (tickIntervalRef.current) { clearInterval(tickIntervalRef.current); tickIntervalRef.current = null; }
    if (maxTimeoutRef.current) { clearTimeout(maxTimeoutRef.current); maxTimeoutRef.current = null; }
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (sourceNodeRef.current) { try { sourceNodeRef.current.disconnect(); } catch { /* */ } sourceNodeRef.current = null; }
    if (analyserRef.current) { try { analyserRef.current.disconnect(); } catch { /* */ } analyserRef.current = null; }
    if (audioContextRef.current) {
      // close() returns a Promise that can reject async (e.g. on iOS Safari
      // when contexts are mid-suspend) — swallow the rejection so it doesn't
      // surface as an unhandled-promise warning. Audit H3.
      try {
        const closePromise = audioContextRef.current.close();
        if (closePromise && typeof closePromise.catch === 'function') {
          closePromise.catch(() => { /* */ });
        }
      } catch { /* sync throw is rare but ignored too */ }
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (state !== 'idle' || !isSupported) return;
    setError(null);
    setState('requesting');
    cancelledRef.current = false;
    const gen = ++generationRef.current;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      if (gen !== generationRef.current) return; // canceled mid-prompt
      const msg = err instanceof Error
        ? (err.name === 'NotAllowedError' ? 'Mic access denied.' : err.message)
        : 'Could not access mic.';
      setError(msg);
      onErrorRef.current?.(msg);
      setState('idle');
      return;
    }

    // Stale resolution check — user pressed cancel or unmount happened during permission prompt.
    if (gen !== generationRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    const mimeType = pickMimeType();

    let recorder: MediaRecorder;
    try {
      // 32 kbps is plenty for speech and keeps a 5-minute memo (~1.2 MB)
      // well under Vercel's 4.5 MB request-body limit once base64-encoded.
      const options: MediaRecorderOptions = { audioBitsPerSecond: 32_000 };
      if (mimeType) options.mimeType = mimeType;
      recorder = new MediaRecorder(stream, options);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const msg = err instanceof Error ? err.message : 'Could not start recorder.';
      setError(msg);
      onErrorRef.current?.(msg);
      setState('idle');
      return;
    }

    recorderRef.current = recorder;
    // Audit C2: capture chunks + mimeType in per-recording closure rather
    // than module-level refs. This eliminates the entire class of "stale
    // onstop fires after a new start() reset the refs" bugs.
    const myChunks: Blob[] = [];
    const myMimeType = mimeType || 'audio/webm';
    let myBytes = 0;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        myChunks.push(e.data);
        myBytes += e.data.size;
        // Some browsers ignore audioBitsPerSecond. Stop before the upload
        // would exceed the server's body limit, so the memo is kept instead
        // of being rejected after the fact.
        if (myBytes >= MAX_RECORDING_BYTES && recorder.state === 'recording') recorder.stop();
      }
    };
    recorder.onstop = () => {
      const myGen = generationRef.current;
      const blob = new Blob(myChunks, { type: myMimeType });
      const duration = Math.round(Math.max(0, (Date.now() - startTimeRef.current) / 1000));
      const wasCancelled = cancelledRef.current;
      tearDown();
      setState('idle');
      setLevel(0);
      setElapsedSec(0);
      if (gen !== myGen) return; // newer recording started, drop this result
      if (!wasCancelled) {
        onCompleteRef.current?.({ blob, mimeType: myMimeType, durationSec: duration });
      }
    };
    recorder.onerror = (e) => {
      const msg = (e as unknown as { error?: { message?: string } }).error?.message ?? 'Recorder error';
      setError(msg);
      onErrorRef.current?.(msg);
      tearDown();
      setState('idle');
    };

    // Web Audio analyser for the level meter
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser); // intentionally NOT connected to destination — no echo
      audioContextRef.current = ctx;
      sourceNodeRef.current = source;
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.fftSize);
      // Capture generation in closure so a frame queued just before
      // tearDown can't fire setLevel against a stale hook (audit H2).
      const myGen = gen;
      const tick = () => {
        if (myGen !== generationRef.current) return;
        const a = analyserRef.current;
        if (!a) return;
        a.getByteTimeDomainData(buf);
        // RMS over -1..1 centered around 128
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        // Map to 0..1 with a gentle curve; clip beyond ~0.5 for visual punch.
        setLevel(Math.min(1, rms * 3));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Level meter is decorative — recording continues if Web Audio fails.
    }

    startTimeRef.current = Date.now();
    setElapsedSec(0);
    tickIntervalRef.current = setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startTimeRef.current) / 1000));
    }, 250);
    maxTimeoutRef.current = setTimeout(() => {
      // Auto-stop at max duration. onstop will fire with the final blob.
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
    }, Math.min(maxDurationSec, 600) * 1000);

    // 1 s timeslice so ondataavailable can track the size while recording.
    recorder.start(1000);
    setState('recording');
  }, [state, isSupported, maxDurationSec, tearDown]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      setState('stopping');
      recorderRef.current.stop();
    } else {
      // No active recording — tear down anyway in case we were mid-request.
      generationRef.current++;
      tearDown();
      setState('idle');
    }
  }, [tearDown]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    generationRef.current++;
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      try { recorderRef.current.stop(); } catch { /* */ }
    }
    tearDown();
    setState('idle');
    setLevel(0);
    setElapsedSec(0);
  }, [tearDown]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      generationRef.current++;
      cancelledRef.current = true;
      tearDown();
    };
  }, [tearDown]);

  return { state, level, elapsedSec, error, isSupported, start, stop, cancel };
}
