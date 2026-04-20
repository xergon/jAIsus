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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(false);

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

      // First frame after camera warms up, then every 10s
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
      activeRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return { isActive, sceneDescription, sceneTimestamp, videoRef, toggle, isSupported, error };
}
