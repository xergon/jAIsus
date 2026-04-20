'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseCameraResult {
  /** Whether the camera is currently active */
  isActive: boolean;
  /** Latest scene description from Gemini */
  sceneDescription: string | null;
  /** Rolling buffer of recent scene observations (last ~30s) */
  sceneHistory: string[];
  /** The video element ref — attach to a <video> for preview */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Toggle camera on/off */
  toggle: () => void;
  /** Whether camera is supported */
  isSupported: boolean;
  /** Error message if any */
  error: string | null;
}

/** How often to capture and analyze a frame (ms) — 10s balances cost vs context */
const CAPTURE_INTERVAL = 10000;

/** How many recent descriptions to keep in the rolling buffer */
const MAX_HISTORY = 3;

/** Max image dimension — keep small to save bandwidth */
const MAX_SIZE = 512;

export function useCamera(): UseCameraResult {
  const [isActive, setIsActive] = useState(false);
  const [sceneDescription, setSceneDescription] = useState<string | null>(null);
  const [sceneHistory, setSceneHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  // Defer support check to client-side only (avoids hydration mismatch)
  useEffect(() => {
    setIsSupported(
      typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    );
  }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(false);

  // Create an offscreen canvas for frame capture
  useEffect(() => {
    if (typeof document !== 'undefined') {
      canvasRef.current = document.createElement('canvas');
    }
  }, []);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    // Scale down to MAX_SIZE while preserving aspect ratio
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

    const frame = captureFrame();
    if (!frame) {
      console.warn('Vision: no frame captured (video not ready?)');
      return;
    }

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
        return;
      }

      const data = await response.json();
      if (data.description && activeRef.current) {
        console.log('Scene:', data.description);
        setSceneDescription(data.description);
        setSceneHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), data.description]);
        setError(null);
      } else if (data.error) {
        console.error('Vision API returned error:', data.error, data.details);
        setError(`Vision: ${data.error}`);
      }
    } catch (err) {
      console.error('Frame analysis error:', err);
    }
  }, [captureFrame]);

  const startCamera = useCallback(async () => {
    if (!isSupported) {
      setError('Camera not supported in this browser');
      return;
    }

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      streamRef.current = stream;
      activeRef.current = true;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      setIsActive(true);

      // Analyze first frame after a short delay (let camera warm up), then every 10s
      setTimeout(() => analyzeFrame(), 1500);
      intervalRef.current = setInterval(() => analyzeFrame(), CAPTURE_INTERVAL);
    } catch (err) {
      console.warn('Camera error:', err);
      if ((err as Error).name === 'NotAllowedError') {
        setError('Camera access denied. Please allow camera access.');
      } else {
        setError('Could not access camera.');
      }
    }
  }, [isSupported, analyzeFrame]);

  const stopCamera = useCallback(() => {
    activeRef.current = false;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
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
    setSceneHistory([]);
  }, []);

  const toggle = useCallback(() => {
    if (isActive) {
      stopCamera();
    } else {
      startCamera();
    }
  }, [isActive, startCamera, stopCamera]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return { isActive, sceneDescription, sceneHistory, videoRef, toggle, isSupported, error };
}
