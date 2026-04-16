'use client';

import { useEffect, useRef, useState } from 'react';
import { EMOTION_VIDEO_MAP, type Emotion } from '@/lib/emotions';

interface AnimatedJesusProps {
  isSpeaking?: boolean;
  emotion?: Emotion;
}

/**
 * Photorealistic animated Jesus — full-bleed background.
 *
 * Two video elements but only ONE decoder active at a time:
 * - Active video plays normally
 * - At 80% through, preload next video into the hidden element
 * - When active ends, instantly swap (no gap, no dual decoders)
 * - Release the old decoder immediately after swap
 */

const VIDEO_PLAYLIST = [
  '/jaisus-embraces.mp4',
  '/jaisus-loves-you.mp4',
  '/jaisus-prays.mp4',
  '/jAisus-angry.mp4',
  '/jAisus-suffers.mp4',
  '/jAisus-shakinghead.mp4',
  '/jAisus_thumps_up.mp4',
];

// Skip last 8 frames (~0.27s at 30fps) to avoid the freeze/glitch at clip end
const SKIP_END_SECONDS = 0.27;

export function AnimatedJesus({ isSpeaking = false, emotion = 'neutral' }: AnimatedJesusProps) {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [mode, setMode] = useState<'video' | 'image' | 'canvas'>('canvas');
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const videosRef = useRef<string[]>([]);
  const activeSlotRef = useRef<'A' | 'B'>('A');
  const currentIndexRef = useRef(0);
  const preloadedRef = useRef(false);
  const mountedRef = useRef(true);
  // Persistent emotion — every swap consults this to pick the next video
  const currentEmotionRef = useRef<Emotion>('neutral');

  // Keep the ref in sync with the prop
  useEffect(() => {
    currentEmotionRef.current = emotion;
  }, [emotion]);

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

  // Video playback engine
  useEffect(() => {
    if (mode !== 'video') return;
    const videos = videosRef.current;
    if (videos.length === 0) return;

    const va = videoARef.current;
    const vb = videoBRef.current;
    if (!va || !vb) return;

    function getActive() { return activeSlotRef.current === 'A' ? va! : vb!; }
    function getNext() { return activeSlotRef.current === 'A' ? vb! : va!; }

    function releaseVideo(el: HTMLVideoElement) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }

    // Initialize: A plays, B is empty
    va.src = videos[0];
    va.load();
    va.style.visibility = 'visible';
    vb.style.visibility = 'hidden';
    releaseVideo(vb);
    activeSlotRef.current = 'A';
    currentIndexRef.current = 0;
    preloadedRef.current = false;
    va.play().catch(() => {});

    /** Pick the best video index for the current emotion */
    function pickEmotionVideo(): number {
      const emo = currentEmotionRef.current;
      const preferred = EMOTION_VIDEO_MAP[emo] || EMOTION_VIDEO_MAP.neutral;
      // Find the first preferred video that exists in our available list
      for (const pref of preferred) {
        const idx = videos.indexOf(pref);
        if (idx !== -1) return idx;
      }
      // Fallback: next sequential
      return (currentIndexRef.current + 1) % videos.length;
    }

    function preloadNext() {
      if (videos.length <= 1 || preloadedRef.current) return;
      preloadedRef.current = true;
      const nextIdx = pickEmotionVideo();
      const next = getNext();
      next.src = videos[nextIdx];
      next.load();
      next.style.visibility = 'hidden';
    }

    function swapToNext() {
      if (videos.length === 0) return;
      currentIndexRef.current = pickEmotionVideo();

      const next = getNext();
      const current = getActive();

      // If next wasn't preloaded, load it now
      if (!preloadedRef.current) {
        next.src = videos[currentIndexRef.current];
        next.load();
      }

      // Show next, hide current — instant swap
      next.style.visibility = 'visible';
      next.play().catch(() => {
        setTimeout(() => { if (mountedRef.current) next.play().catch(() => {}); }, 300);
      });

      // Hide and release old one after a tiny delay (lets the new one render first)
      setTimeout(() => {
        current.style.visibility = 'hidden';
        releaseVideo(current);
      }, 50);

      activeSlotRef.current = activeSlotRef.current === 'A' ? 'B' : 'A';
      preloadedRef.current = false;
    }

    function onTimeUpdate(this: HTMLVideoElement) {
      const active = getActive();
      if (this !== active) return;
      if (!this.duration || this.duration === Infinity) return;

      const progress = this.currentTime / this.duration;
      const remaining = this.duration - this.currentTime;

      // Preload at 80% — if there's an emotion request, preload THAT video
      if (progress > 0.8) {
        preloadNext();
      }

      // Let the clip play to completion (minus last 8 frames), then swap
      if (remaining <= SKIP_END_SECONDS) {
        this.pause();
        swapToNext();
      }
    }

    function onEnded(this: HTMLVideoElement) {
      if (this === getActive()) swapToNext();
    }

    function onError(this: HTMLVideoElement) {
      console.warn('Video error, skipping');
      if (this === getActive()) swapToNext();
    }

    function onVisibilityChange() {
      if (document.hidden) {
        getActive().pause();
      } else {
        const active = getActive();
        if (active.src) active.play().catch(() => {});
      }
    }

    // Stall watchdog
    let lastTime = 0;
    let stallCount = 0;
    const stallWatchdog = setInterval(() => {
      if (!mountedRef.current) return;
      const active = getActive();
      if (active.paused && !document.hidden) {
        stallCount++;
        if (stallCount > 1) { swapToNext(); stallCount = 0; }
        else active.play().catch(() => swapToNext());
      } else if (active.currentTime === lastTime && !active.paused) {
        stallCount++;
        if (stallCount > 2) { swapToNext(); stallCount = 0; }
      } else {
        stallCount = 0;
      }
      lastTime = active.currentTime;
    }, 4000);

    va.addEventListener('timeupdate', onTimeUpdate);
    vb.addEventListener('timeupdate', onTimeUpdate);
    va.addEventListener('ended', onEnded);
    vb.addEventListener('ended', onEnded);
    va.addEventListener('error', onError);
    vb.addEventListener('error', onError);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(stallWatchdog);
      va.removeEventListener('timeupdate', onTimeUpdate);
      vb.removeEventListener('timeupdate', onTimeUpdate);
      va.removeEventListener('ended', onEnded);
      vb.removeEventListener('ended', onEnded);
      va.removeEventListener('error', onError);
      vb.removeEventListener('error', onError);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      releaseVideo(va);
      releaseVideo(vb);
    };
  }, [mode]);

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

  // Video mode — dual elements but only one decoder active at a time
  if (mode === 'video') {
    return (
      <div className="absolute inset-0 w-full h-full bg-[#0a0e1a]">
        <video
          ref={videoARef}
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover object-top"
          style={{ filter: 'brightness(1.05) contrast(1.02)' }}
        />
        <video
          ref={videoBRef}
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover object-top"
          style={{ filter: 'brightness(1.05) contrast(1.02)' }}
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
