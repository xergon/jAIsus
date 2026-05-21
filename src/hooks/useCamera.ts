'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export interface SceneObservation {
  description: string;
  timestamp: number;
}

interface UseCameraResult {
  /** Whether the camera is currently active */
  isActive: boolean;
  /** Latest scene description from Gemini */
  sceneDescription: string | null;
  /** Timestamp of latest scene description */
  sceneTimestamp: number;
  /** The video element ref — attach to a <video> for preview */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Toggle camera on/off */
  toggle: () => void;
  /** Whether camera is supported */
  isSupported: boolean;
  /** Error message if any */
  error: string | null;
}

/** How often to capture and analyze a frame (ms) */
const CAPTURE_INTERVAL = 10000;

/** Max image dimension — keep small to save bandwidth */
const MAX_SIZE = 512;

export function useCamera(): UseCameraResult {
  const [isActive, setIsActive] = useState(false);
  const [sceneDescription, setSceneDescription] = useState<string | null>(null);
  const [sceneTimestamp, setSceneTimestamp] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(
      typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    );
  }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstFrameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(false);
  // Generation counter — incremented on every stopCamera / unmount.
  // startCamera captures the current generation before awaiting getUserMedia;
  // if the generation has changed by the time the promise resolves, the user
  // has already turned the camera off and we must NOT install the stream
  // (otherwise rapid toggling leaks orphaned MediaStream tracks).
  const generationRef = useRef(0);
  // In-flight guard for /api/vision. Without this, if Gemini latency exceeds
  // the 10s capture interval, multiple fetches stack up — wasting quota AND
  // racing on setSceneDescription. The guard makes overlapping calls a no-op.
  const visionInFlightRef = useRef(false);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      canvasRef.current = document.createElement('canvas');
    }
  }, []);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const scale = Math.min(MAX_SIZE / video.videoWidth, MAX_SIZE / video.videoHeight, 1);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }, []);

  const analyzeFrame = useCallback(async () => {
    if (!activeRef.current) return;
    // Skip vision when tab is hidden — user can't see results anyway,
    // and Gemini quota is precious
    if (typeof document !== 'undefined' && document.hidden) return;
    // Skip if a previous /api/vision request is still in flight. Prevents
    // request pileup under slow Gemini latency (>10s capture interval).
    if (visionInFlightRef.current) return;

    const frame = captureFrame();
    if (!frame) {
      console.warn('Vision: no frame captured (video not ready?)');
      return;
    }

    visionInFlightRef.current = true;
    try {
      const response = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: frame }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error('Vision API error:', response.status, body);
        setError(`Vision API error: ${response.status}`);
        return; // visionInFlightRef.current reset by the finally block below
      }

      const data = await response.json();
      if (data.description && activeRef.current) {
        const now = Date.now();
        console.log('Scene [fresh]:', data.description);
        setSceneDescription(data.description);
        setSceneTimestamp(now);
        setError(null);
      } else if (data.error) {
        console.error('Vision API returned error:', data.error, data.details);
        setError(`Vision: ${data.error}`);
      }
    } catch (err) {
      console.error('Frame analysis error:', err);
    } finally {
      visionInFlightRef.current = false;
    }
  }, [captureFrame]);

  const startCamera = useCallback(async () => {
    if (!isSupported) {
      setError('Camera not supported in this browser');
      return;
    }

    // Capture generation before awaiting — if stopCamera/unmount bumps the
    // generation before getUserMedia resolves, we must NOT install the stream.
    const gen = generationRef.current;

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      // Stale resolution — user canceled or component unmounted while the
      // permission prompt was open. Stop the tracks immediately to release
      // the hardware indicator and prevent the orphan-stream leak.
      if (gen !== generationRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      activeRef.current = true;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      setIsActive(true);

      // First frame after camera warms up, then every 10s
      firstFrameTimeoutRef.current = setTimeout(() => analyzeFrame(), 1500);
      intervalRef.current = setInterval(() => analyzeFrame(), CAPTURE_INTERVAL);
    } catch (err) {
      // If stale, swallow silently — user already turned camera off
      if (gen !== generationRef.current) return;
      console.warn('Camera error:', err);
      if ((err as Error).name === 'NotAllowedError') {
        setError('Camera access denied. Please allow camera access.');
      } else {
        setError('Could not access camera.');
      }
    }
  }, [isSupported, analyzeFrame]);

  const stopCamera = useCallback(() => {
    // Bump generation FIRST so any in-flight getUserMedia bails out
    generationRef.current++;
    activeRef.current = false;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (firstFrameTimeoutRef.current) {
      clearTimeout(firstFrameTimeoutRef.current);
      firstFrameTimeoutRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsActive(false);
    setSceneDescription(null);
    setSceneTimestamp(0);
  }, []);

  const toggle = useCallback(() => {
    if (isActive) {
      stopCamera();
    } else {
      startCamera();
    }
  }, [isActive, startCamera, stopCamera]);

  useEffect(() => {
    return () => {
      // Bump generation so any pending getUserMedia bails out
      generationRef.current++;
      activeRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (firstFrameTimeoutRef.current) clearTimeout(firstFrameTimeoutRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return { isActive, sceneDescription, sceneTimestamp, videoRef, toggle, isSupported, error };
}
