'use client';

import { useEffect, useRef, useState } from 'react';

interface AnimatedJesusProps {
  isSpeaking?: boolean;
}

/**
 * Photorealistic animated Jesus — full-bleed background.
 *
 * Uses a SINGLE video element to avoid Chrome memory crashes.
 * Videos rotate by switching src after each clip ends.
 * No crossfade = no dual decoders = no OOM crashes.
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

const SKIP_END_SECONDS = 0.35; // Skip last ~8 frames to avoid freeze-frame

export function AnimatedJesus({ isSpeaking = false }: AnimatedJesusProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [mode, setMode] = useState<'video' | 'image' | 'canvas'>('canvas');
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const videosRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
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

  // Single-element video playback engine
  useEffect(() => {
    if (mode !== 'video') return;
    const videos = videosRef.current;
    if (videos.length === 0) return;

    const video = videoRef.current;
    if (!video) return;

    currentIndexRef.current = 0;
    video.src = videos[0];
    video.load();
    video.play().catch(() => {});

    function playNext() {
      if (!mountedRef.current || videos.length === 0) return;
      currentIndexRef.current = (currentIndexRef.current + 1) % videos.length;
      video!.src = videos[currentIndexRef.current];
      video!.load();
      video!.play().catch(() => {
        // If play fails, try again after a short delay
        setTimeout(() => {
          if (mountedRef.current) video!.play().catch(() => {});
        }, 500);
      });
    }

    function onTimeUpdate() {
      if (!video!.duration || video!.duration === Infinity) return;
      const remaining = video!.duration - video!.currentTime;
      // Skip last frames to avoid freeze-frame at end
      if (remaining <= SKIP_END_SECONDS) {
        video!.pause();
        playNext();
      }
    }

    function onEnded() {
      playNext();
    }

    function onError() {
      console.warn('Video error, skipping to next');
      playNext();
    }

    // Handle tab visibility — pause when hidden, resume when visible
    function onVisibilityChange() {
      if (document.hidden) {
        video!.pause();
      } else {
        if (video!.src) {
          video!.play().catch(() => {});
        }
      }
    }

    // Stall watchdog: if video hasn't progressed in 4s, skip
    let lastTime = 0;
    let stallCount = 0;
    const stallWatchdog = setInterval(() => {
      if (!mountedRef.current) return;
      if (video!.paused && !document.hidden) {
        stallCount++;
        if (stallCount > 1) {
          console.warn('Video stalled, skipping');
          playNext();
          stallCount = 0;
        } else {
          video!.play().catch(() => playNext());
        }
      } else if (video!.currentTime === lastTime && !video!.paused) {
        stallCount++;
        if (stallCount > 2) {
          console.warn('Video decoder stalled, skipping');
          playNext();
          stallCount = 0;
        }
      } else {
        stallCount = 0;
      }
      lastTime = video!.currentTime;
    }, 4000);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(stallWatchdog);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      video.pause();
      video.removeAttribute('src');
      video.load();
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

  // Video mode — single element, no crossfade, no memory leaks
  if (mode === 'video') {
    return (
      <div className="absolute inset-0 w-full h-full bg-[#0a0e1a]">
        <video
          ref={videoRef}
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover object-top"
          style={{
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
