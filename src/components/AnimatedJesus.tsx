'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface AnimatedJesusProps {
  isSpeaking?: boolean;
}

/**
 * Photorealistic animated Jesus — full-bleed background with multi-video rotation.
 *
 * - Videos crossfade between each other using dual video slots (A/B)
 * - CRITICAL: Last 8 frames of each video are NEVER displayed.
 *   At ~24fps that's ~0.333s. We monitor timeupdate and trigger
 *   crossfade when remaining time <= SKIP_END_SECONDS.
 * - Falls back to static image or canvas if no videos available.
 * - Videos start/end on the still portrait frame for smooth blending.
 */

// Emotion video playlist — all in Videos/ folder with jAisus- prefix
const VIDEO_PLAYLIST = [
  '/jAisus-embraces.mp4',
  '/jAisus-loves-you.mp4',
  '/jAisus-prays.mp4',
  '/jAisus-angry.mp4',
  '/jAisus-suffers.mp4',
  '/jAisus-shakinghead.mp4',
  '/jAisus_thumps_up.mp4',
];

// Skip the last 8 frames. At 24fps = 0.333s, use 0.35s for safety margin
const SKIP_END_SECONDS = 0.35;
// 4 frames at 24fps ≈ 167ms
const CROSSFADE_MS = 167;

export function AnimatedJesus({ isSpeaking = false }: AnimatedJesusProps) {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [mode, setMode] = useState<'video' | 'image' | 'canvas'>('canvas');
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [availableVideos, setAvailableVideos] = useState<string[]>([]);
  const [activeSlot, setActiveSlot] = useState<'A' | 'B'>('A');
  const [opacityA, setOpacityA] = useState(1);
  const [opacityB, setOpacityB] = useState(0);
  const currentIndexRef = useRef(0);
  const transitioningRef = useRef(false);

  // Detect available videos on mount
  useEffect(() => {
    const found: string[] = [];
    let checked = 0;

    function done() {
      if (found.length > 0) {
        // Preserve playlist order
        const ordered = VIDEO_PLAYLIST.filter(v => found.includes(v));
        setAvailableVideos(ordered);
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
  }, []);

  // Preload next video into the hidden slot so it's ready before crossfade
  const preloadNextRef = useRef(false);

  const preloadNext = useCallback(() => {
    if (availableVideos.length <= 1 || preloadNextRef.current) return;
    preloadNextRef.current = true;
    const nextIndex = (currentIndexRef.current + 1) % availableVideos.length;
    const nextSrc = availableVideos[nextIndex];
    const nextSlot = activeSlot === 'A' ? videoBRef.current : videoARef.current;
    if (nextSlot && nextSlot.getAttribute('data-preloaded') !== nextSrc) {
      nextSlot.src = nextSrc;
      nextSlot.load();
      nextSlot.setAttribute('data-preloaded', nextSrc);
    }
  }, [availableVideos, activeSlot]);

  // Crossfade: the hidden slot is already preloaded — just play + swap opacity
  const transitionToNext = useCallback(() => {
    if (availableVideos.length === 0 || transitioningRef.current) return;
    transitioningRef.current = true;

    const nextIndex = (currentIndexRef.current + 1) % availableVideos.length;
    currentIndexRef.current = nextIndex;

    if (activeSlot === 'A') {
      const vb = videoBRef.current;
      if (vb) {
        // Should already be preloaded — just play
        const playPromise = vb.play();
        if (playPromise) playPromise.catch(() => {});
      }
      // Both at full opacity briefly = no black flash
      setOpacityB(1);
      // Slight delay then fade out A
      requestAnimationFrame(() => {
        setOpacityA(0);
      });
      setActiveSlot('B');
    } else {
      const va = videoARef.current;
      if (va) {
        const playPromise = va.play();
        if (playPromise) playPromise.catch(() => {});
      }
      setOpacityA(1);
      requestAnimationFrame(() => {
        setOpacityB(0);
      });
      setActiveSlot('A');
    }

    preloadNextRef.current = false;
    // Allow next transition after crossfade completes
    setTimeout(() => { transitioningRef.current = false; }, CROSSFADE_MS + 200);
  }, [availableVideos, activeSlot]);

  // Start first video and monitor timeupdate to skip last 8 frames
  useEffect(() => {
    if (mode !== 'video' || availableVideos.length === 0) return;

    const va = videoARef.current;
    if (va && !va.src) {
      va.src = availableVideos[0];
      va.load();
      va.play().catch(() => {});
      setOpacityA(1);
      setOpacityB(0);
      setActiveSlot('A');
    }

    // Monitor time: preload at 50%, crossfade at end minus 8 frames
    function checkTime(video: HTMLVideoElement) {
      if (!video.duration || video.duration === Infinity) return;
      const remaining = video.duration - video.currentTime;
      const halfway = video.duration * 0.5;

      // Preload next video when we pass the halfway point
      if (video.currentTime > halfway) {
        preloadNext();
      }

      // CRITICAL: Skip last 8 frames — pause + crossfade
      if (remaining <= SKIP_END_SECONDS && !transitioningRef.current) {
        video.pause();
        transitionToNext();
      }
    }

    function onTimeUpdateA() {
      const v = videoARef.current;
      if (v && activeSlot === 'A') checkTime(v);
    }
    function onTimeUpdateB() {
      const v = videoBRef.current;
      if (v && activeSlot === 'B') checkTime(v);
    }

    // Also handle natural ended event as safety fallback
    function onEndedA() { if (!transitioningRef.current) transitionToNext(); }
    function onEndedB() { if (!transitioningRef.current) transitionToNext(); }

    const vaEl = videoARef.current;
    const vbEl = videoBRef.current;
    vaEl?.addEventListener('timeupdate', onTimeUpdateA);
    vbEl?.addEventListener('timeupdate', onTimeUpdateB);
    vaEl?.addEventListener('ended', onEndedA);
    vbEl?.addEventListener('ended', onEndedB);

    return () => {
      vaEl?.removeEventListener('timeupdate', onTimeUpdateA);
      vbEl?.removeEventListener('timeupdate', onTimeUpdateB);
      vaEl?.removeEventListener('ended', onEndedA);
      vbEl?.removeEventListener('ended', onEndedB);
    };
  }, [mode, availableVideos, activeSlot, transitionToNext, preloadNext]);

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

      // Ambient glow
      const bgGrad = ctx.createRadialGradient(W / 2, H * 0.3, 20, W / 2, H * 0.45, W * 0.8);
      bgGrad.addColorStop(0, 'rgba(255, 248, 230, 0.12)');
      bgGrad.addColorStop(0.5, 'rgba(255, 235, 200, 0.04)');
      bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Light rays
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

  // Video mode — dual-slot crossfade with last-8-frame protection
  if (mode === 'video') {
    return (
      <div className="absolute inset-0 w-full h-full bg-[#0a0e1a]">
        <video
          ref={videoARef}
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover object-top"
          style={{
            opacity: opacityA,
            transition: `opacity ${CROSSFADE_MS}ms ease-in-out`,
            filter: 'brightness(1.05) contrast(1.02)',
          }}
        />
        <video
          ref={videoBRef}
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover object-top"
          style={{
            opacity: opacityB,
            transition: `opacity ${CROSSFADE_MS}ms ease-in-out`,
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
