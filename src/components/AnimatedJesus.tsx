'use client';

import { useEffect, useRef, useState } from 'react';

interface AnimatedJesusProps {
  isSpeaking?: boolean;
}

/**
 * Photorealistic animated Jesus — full-bleed background with multi-video rotation.
 *
 * Uses refs + direct DOM manipulation for opacity to avoid React re-render
 * issues that cause dark flashes between crossfades.
 *
 * - Videos crossfade using dual video slots (A/B)
 * - Last 8 frames of each video are NEVER displayed
 * - Preloads next video at halfway point
 * - Falls back to static image or canvas if no videos available
 */

const VIDEO_PLAYLIST = [
  '/jAisus-embraces.mp4',
  '/jAisus-loves-you.mp4',
  '/jAisus-prays.mp4',
  '/jAisus-angry.mp4',
  '/jAisus-suffers.mp4',
  '/jAisus-shakinghead.mp4',
  '/jAisus_thumps_up.mp4',
];

const SKIP_END_SECONDS = 0.35; // 8 frames at 24fps
const CROSSFADE_MS = 167; // 4 frames at 24fps

export function AnimatedJesus({ isSpeaking = false }: AnimatedJesusProps) {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [mode, setMode] = useState<'video' | 'image' | 'canvas'>('canvas');
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // ALL mutable playback state as refs — no React re-renders during playback
  const videosRef = useRef<string[]>([]);
  const activeSlotRef = useRef<'A' | 'B'>('A');
  const currentIndexRef = useRef(0);
  const transitioningRef = useRef(false);
  const preloadedRef = useRef(false);
  const mountedRef = useRef(true);

  // Detect available videos on mount
  useEffect(() => {
    mountedRef.current = true;
    const found: string[] = [];
    let checked = 0;

    function done() {
      if (!mountedRef.current) return;
      if (found.length > 0) {
        const ordered = VIDEO_PLAYLIST.filter(v => found.includes(v));
        videosRef.current = ordered;
        setMode('video');
      } else {
        const tryImages = ['/jesus-portrait.jpg', '/jesus-portrait.png'];
        let tried = 0;
        function tryNextImage() {
          if (tried >= tryImages.length) { setMode('canvas'); setImageLoaded(true); return; }
          const img = new Image();
          img.src = tryImages[tried];
          img.onload = () => { imageRef.current = img; setMode('image'); setImageLoaded(true); };
          img.onerror = () => { tried++; tryNextImage(); };
        }
        tryNextImage();
      }
    }

    VIDEO_PLAYLIST.forEach(src => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = src;
      v.onloadedmetadata = () => { found.push(src); checked++; if (checked === VIDEO_PLAYLIST.length) done(); };
      v.onerror = () => { checked++; if (checked === VIDEO_PLAYLIST.length) done(); };
    });

    setTimeout(() => { if (checked < VIDEO_PLAYLIST.length) { checked = VIDEO_PLAYLIST.length; done(); } }, 4000);

    return () => { mountedRef.current = false; };
  }, []);

  // Video playback engine — runs once when mode becomes 'video'
  useEffect(() => {
    if (mode !== 'video') return;
    const videos = videosRef.current;
    if (videos.length === 0) return;

    const va = videoARef.current;
    const vb = videoBRef.current;
    if (!va || !vb) return;

    // Initialize: load first video into slot A, set opacities directly
    va.src = videos[0];
    va.load();
    va.style.opacity = '1';
    vb.style.opacity = '0';
    activeSlotRef.current = 'A';
    currentIndexRef.current = 0;
    preloadedRef.current = false;
    transitioningRef.current = false;

    // Try to autoplay — some browsers need this after load
    va.play().catch(() => {});

    function getActiveVideo(): HTMLVideoElement | null {
      return activeSlotRef.current === 'A' ? va : vb;
    }

    function getInactiveVideo(): HTMLVideoElement | null {
      return activeSlotRef.current === 'A' ? vb : va;
    }

    function preloadNext() {
      if (videos.length <= 1 || preloadedRef.current) return;
      preloadedRef.current = true;
      const nextIdx = (currentIndexRef.current + 1) % videos.length;
      const nextSrc = videos[nextIdx];
      const inactive = getInactiveVideo();
      if (inactive && inactive.getAttribute('data-src') !== nextSrc) {
        inactive.src = nextSrc;
        inactive.load();
        inactive.setAttribute('data-src', nextSrc);
      }
    }

    function transitionToNext() {
      if (transitioningRef.current || videos.length === 0) return;
      transitioningRef.current = true;

      currentIndexRef.current = (currentIndexRef.current + 1) % videos.length;

      const incoming = getInactiveVideo();
      const outgoing = getActiveVideo();

      if (incoming) {
        // CRITICAL: Set incoming to full opacity BEFORE starting playback
        incoming.style.opacity = '1';
        incoming.play().catch(() => {});
      }

      // One frame later, fade out the outgoing video
      // This ensures both videos overlap at full opacity = no black flash
      requestAnimationFrame(() => {
        if (outgoing) {
          outgoing.style.opacity = '0';
        }
      });

      // Swap active slot
      activeSlotRef.current = activeSlotRef.current === 'A' ? 'B' : 'A';
      preloadedRef.current = false;

      // Allow next transition after crossfade + safety margin
      setTimeout(() => {
        transitioningRef.current = false;
        // Pause the now-hidden outgoing video to save resources
        if (outgoing) {
          outgoing.pause();
        }
      }, CROSSFADE_MS + 300);
    }

    function onTimeUpdate(this: HTMLVideoElement) {
      const video = this;
      // Only process timeupdate for the currently active video
      if (
        (activeSlotRef.current === 'A' && video !== va) ||
        (activeSlotRef.current === 'B' && video !== vb)
      ) return;

      if (!video.duration || video.duration === Infinity) return;
      const remaining = video.duration - video.currentTime;

      // Preload at halfway
      if (video.currentTime > video.duration * 0.5) {
        preloadNext();
      }

      // Skip last 8 frames: pause + crossfade
      if (remaining <= SKIP_END_SECONDS && !transitioningRef.current) {
        video.pause();
        transitionToNext();
      }
    }

    function onEnded(this: HTMLVideoElement) {
      // Safety fallback if timeupdate didn't catch the end
      if (!transitioningRef.current) {
        transitionToNext();
      }
    }

    function onError(this: HTMLVideoElement) {
      // If a video errors during playback, skip to next
      console.warn('Video error, skipping to next');
      if (!transitioningRef.current) {
        transitionToNext();
      }
    }

    // Attach listeners
    va.addEventListener('timeupdate', onTimeUpdate);
    vb.addEventListener('timeupdate', onTimeUpdate);
    va.addEventListener('ended', onEnded);
    vb.addEventListener('ended', onEnded);
    va.addEventListener('error', onError);
    vb.addEventListener('error', onError);

    return () => {
      va.removeEventListener('timeupdate', onTimeUpdate);
      vb.removeEventListener('timeupdate', onTimeUpdate);
      va.removeEventListener('ended', onEnded);
      vb.removeEventListener('ended', onEnded);
      va.removeEventListener('error', onError);
      vb.removeEventListener('error', onError);
      va.pause();
      vb.pause();
    };
  }, [mode]); // Only re-run when mode changes, NOT on every state update

  // Canvas animation for image and fallback modes
  useEffect(() => {
    if (mode === 'video') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxOrNull = canvas.getContext('2d');
    if (!ctxOrNull) return;
    const ctx = ctxOrNull;
    const W = canvas.width;
    const H = canvas.height;

    const particles: Array<{
      x: number; y: number; vx: number; vy: number;
      size: number; alpha: number; life: number; maxLife: number; color: string;
    }> = [];

    const rays: Array<{
      angle: number; length: number; width: number;
      speed: number; alpha: number; phase: number;
    }> = [];

    for (let i = 0; i < 16; i++) {
      rays.push({
        angle: (i / 16) * Math.PI * 2,
        length: 100 + Math.random() * 150,
        width: 1 + Math.random() * 3,
        speed: 0.3 + Math.random() * 0.5,
        alpha: 0.08 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
      });
    }

    function spawnParticle() {
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 100;
      particles.push({
        x: W / 2 + Math.cos(angle) * dist,
        y: H * 0.5 + Math.sin(angle) * (dist * 0.6),
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.3 - Math.random() * 0.8,
        size: 1 + Math.random() * 2.5,
        alpha: 0, life: 0,
        maxLife: 80 + Math.random() * 60,
        color: Math.random() > 0.5 ? '#FFD700' : Math.random() > 0.5 ? '#FFA500' : '#FFFACD',
      });
    }

    let time = 0;

    function animate() {
      time += 0.016;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0a0e1a';
      ctx.fillRect(0, 0, W, H);

      const bgGrad = ctx.createRadialGradient(W / 2, H * 0.3, 20, W / 2, H * 0.45, W * 0.8);
      bgGrad.addColorStop(0, 'rgba(255, 248, 230, 0.12)');
      bgGrad.addColorStop(0.5, 'rgba(255, 235, 200, 0.04)');
      bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      rays.forEach(ray => {
        const alpha = ray.alpha * (0.5 + 0.5 * Math.sin(time * ray.speed + ray.phase));
        const len = ray.length * (0.7 + 0.3 * Math.sin(time * ray.speed * 0.5 + ray.phase));
        ctx.save();
        ctx.translate(W / 2, H * 0.35);
        ctx.rotate(ray.angle + time * 0.015);
        const rayGrad = ctx.createLinearGradient(0, 0, 0, len);
        rayGrad.addColorStop(0, `rgba(255, 215, 0, ${alpha})`);
        rayGrad.addColorStop(0.6, `rgba(255, 200, 100, ${alpha * 0.4})`);
        rayGrad.addColorStop(1, 'rgba(255, 180, 50, 0)');
        ctx.fillStyle = rayGrad;
        ctx.fillRect(-ray.width / 2, 0, ray.width, len);
        ctx.restore();
      });

      if (mode === 'image' && imageRef.current) {
        const img = imageRef.current;
        const breathe = Math.sin(time * 0.8) * 1;
        const imgW = W;
        const imgH = (img.height / img.width) * imgW;
        ctx.save();
        ctx.drawImage(img, 0, -imgH * 0.05 + breathe, imgW, imgH);
        ctx.restore();
      }

      if (Math.random() < 0.3) spawnParticle();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++; p.x += p.vx; p.y += p.vy; p.vy -= 0.003;
        const lifeRatio = p.life / p.maxLife;
        if (lifeRatio < 0.15) p.alpha = lifeRatio / 0.15;
        else if (lifeRatio > 0.7) p.alpha = (1 - lifeRatio) / 0.3;
        else p.alpha = 1;
        if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = p.alpha * 0.5;
        const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2.5);
        pg.addColorStop(0, p.color);
        pg.addColorStop(1, 'rgba(255, 215, 0, 0)');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(animate);
    }

    animate();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [mode, imageLoaded, isSpeaking]);

  // Video mode — dual-slot crossfade
  if (mode === 'video') {
    return (
      <div className="absolute inset-0 w-full h-full bg-[#0a0e1a]">
        <video
          ref={videoARef}
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover object-top"
          style={{
            transition: `opacity ${CROSSFADE_MS}ms linear`,
            filter: 'brightness(1.05) contrast(1.02)',
          }}
        />
        <video
          ref={videoBRef}
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover object-top"
          style={{
            transition: `opacity ${CROSSFADE_MS}ms linear`,
            filter: 'brightness(1.05) contrast(1.02)',
          }}
        />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 w-full h-full">
      <canvas
        ref={canvasRef}
        width={500}
        height={600}
        className="w-full h-full"
        style={{ imageRendering: 'auto' }}
      />
    </div>
  );
}
