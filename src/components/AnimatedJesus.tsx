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

// Stop playback at 7s16f (7.667s) out of 8s clips — last 8 frames skipped in playback.
const SKIP_END_SECONDS = 0.333;

export function AnimatedJesus({ isSpeaking = false, emotion = 'neutral' }: AnimatedJesusProps) {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [mode, setMode] = useState<'video' | 'image' | 'canvas'>('canvas');
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [videoReady, setVideoReady] = useState(false);
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

  // Detect available videos on mount.
  //
  // CRITICAL: each probe video element holds a real decoder slot. iOS Safari
  // caps active decoders at ~16, often allows only 1 at a time. Previously
  // the 7 probes were never released and could block real playback. Now we:
  //  1. Release each probe's src as soon as metadata fires (or errors).
  //  2. Track all probes so cleanup can release any still hanging.
  //  3. Guard `done()`, the image probes, and the safety timeout against
  //     calling setState on an unmounted component.
  useEffect(() => {
    mountedRef.current = true;
    const found: string[] = [];
    let checked = 0;
    const probes: HTMLVideoElement[] = [];
    const imageProbes: HTMLImageElement[] = [];
    let detectTimeout: ReturnType<typeof setTimeout> | null = null;

    function releaseProbe(v: HTMLVideoElement) {
      try {
        v.onloadedmetadata = null;
        v.onerror = null;
        v.removeAttribute('src');
        v.load();
      } catch {
        // Best-effort — element may already be GC'd
      }
    }

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
          if (!mountedRef.current) return;
          if (tried >= tryImages.length) { setMode('canvas'); setImageLoaded(true); return; }
          const img = new Image();
          imageProbes.push(img);
          img.src = tryImages[tried];
          img.onload = () => {
            if (!mountedRef.current) return;
            imageRef.current = img;
            setMode('image');
            setImageLoaded(true);
          };
          img.onerror = () => {
            if (!mountedRef.current) return;
            tried++;
            tryNextImage();
          };
        }
        tryNextImage();
      }
    }

    VIDEO_PLAYLIST.forEach(src => {
      const v = document.createElement('video');
      probes.push(v);
      v.preload = 'metadata';
      v.muted = true; // Safari sometimes refuses metadata load on unmuted off-document elements
      v.src = src;
      v.onloadedmetadata = () => {
        found.push(src);
        checked++;
        releaseProbe(v);
        if (checked === VIDEO_PLAYLIST.length) done();
      };
      v.onerror = () => {
        checked++;
        releaseProbe(v);
        if (checked === VIDEO_PLAYLIST.length) done();
      };
    });

    detectTimeout = setTimeout(() => {
      if (checked < VIDEO_PLAYLIST.length) {
        checked = VIDEO_PLAYLIST.length;
        done();
      }
    }, 4000);

    return () => {
      mountedRef.current = false;
      if (detectTimeout) clearTimeout(detectTimeout);
      // Release any probes that haven't fired metadata yet
      probes.forEach(releaseProbe);
      // Detach image probe handlers
      imageProbes.forEach(img => {
        img.onload = null;
        img.onerror = null;
      });
    };
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

    // Initialize: A plays, B is empty. Hide until first frame is decoded.
    // Audit fix: attach the reveal listeners BEFORE setting src + calling
    // load(). On a warm HTTP cache, loadeddata / canplay can fire synchronously
    // from load(), so attaching after would miss the events and the safety
    // interval (500ms tick) would handle reveal — adding 500ms-2s of delay
    // to the initial paint.
    va.style.visibility = 'hidden';
    vb.style.visibility = 'hidden';
    releaseVideo(vb);
    activeSlotRef.current = 'A';
    currentIndexRef.current = 0;
    preloadedRef.current = false;

    // Audit fix: track every setTimeout spawned inside this effect so the
    // cleanup can clear them. Without this, late-firing timeouts (the
    // play-retry fallbacks and the swap delay) can call setState or
    // releaseVideo on torn-down elements after unmount.
    const pendingTimeouts: Array<ReturnType<typeof setTimeout>> = [];
    const trackTimeout = (cb: () => void, ms: number): ReturnType<typeof setTimeout> => {
      const id = setTimeout(() => {
        const i = pendingTimeouts.indexOf(id);
        if (i !== -1) pendingTimeouts.splice(i, 1);
        cb();
      }, ms);
      pendingTimeouts.push(id);
      return id;
    };

    // Audit fix: bound onError → swapToNext recursion. If every video errors
    // immediately on load (e.g. all assets 404), onError fires synchronously
    // from swapToNext which calls swapToNext again — stack overflow. Bail
    // after N consecutive errors and let the safety interval catch the case.
    let consecutiveErrorCount = 0;
    const MAX_CONSECUTIVE_ERRORS = 8;

    let revealed = false;
    function revealVideo() {
      if (revealed || !va) return;
      // Only reveal once the video has actual dimensions AND is playing —
      // Chrome shows a distorted/zoomed first frame if we reveal too early
      if (va.videoWidth === 0 || va.videoHeight === 0) {
        // Dimensions not ready yet — wait for next event
        return;
      }
      revealed = true;
      va.removeEventListener('loadeddata', revealVideo);
      va.removeEventListener('canplay', revealVideo);
      va.removeEventListener('playing', revealVideo);
      va.removeEventListener('resize', revealVideo);
      if (!mountedRef.current) return;
      // Small delay lets Chrome finish compositing the frame with correct object-fit
      requestAnimationFrame(() => {
        if (!mountedRef.current || !va) return;
        va.style.visibility = 'visible';
        setVideoReady(true);
      });
    }
    // 'playing' = actually rendering frames (best signal)
    // 'resize' = video dimensions changed (fires when first frame decodes)
    // 'loadeddata' / 'canplay' = fallback for browsers that don't fire playing
    va.addEventListener('playing', revealVideo);
    va.addEventListener('resize', revealVideo);
    va.addEventListener('loadeddata', revealVideo);
    va.addEventListener('canplay', revealVideo);

    // NOW kick off the load — listeners are in place to catch even the
    // synchronous events that fire on a cache hit.
    va.src = videos[0];
    va.load();

    // Safety: only reveal if dimensions are actually ready.
    // Previous version revealed even with videoWidth===0, which caused the
    // first-load distortion (Chrome paints a 0-sized element stretched).
    // Now we retry every 500ms up to 12s, and only reveal when ready.
    let safetyTries = 0;
    const safetyInterval = setInterval(() => {
      if (revealed || !va) {
        clearInterval(safetyInterval);
        return;
      }
      safetyTries++;
      if (va.videoWidth > 0 && va.videoHeight > 0) {
        clearInterval(safetyInterval);
        revealVideo();
      } else if (safetyTries >= 24) {
        // 12s gone and still no dimensions — give up on video, fall back
        clearInterval(safetyInterval);
        if (mountedRef.current) {
          console.warn('Video failed to decode after 12s — falling back to canvas');
          setMode('canvas');
        }
      }
    }, 500);

    va.play().catch(() => {
      // Autoplay blocked — wait a beat then reveal the still frame
      trackTimeout(revealVideo, 300);
    });

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

    // Track which video index was loaded into the "next" slot during preload,
    // so swapToNext can detect if the user's emotion changed between preload
    // (at 80% of current clip) and the actual swap (at clip end). Without
    // this, swapToNext would play whatever was preloaded even though the
    // emotion may now want a different video.
    let preloadedIdx = -1;

    function preloadNext() {
      if (videos.length <= 1 || preloadedRef.current) return;
      preloadedRef.current = true;
      const nextIdx = pickEmotionVideo();
      preloadedIdx = nextIdx;
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

      // If next wasn't preloaded — or it was preloaded with a different
      // emotion's video (user's emotion changed between preload @ 80% and
      // the swap) — (re)load the correct source now. Audit fix: previously
      // we trusted preloadedRef.current alone and could play the wrong clip.
      if (!preloadedRef.current || preloadedIdx !== currentIndexRef.current) {
        next.src = videos[currentIndexRef.current];
        next.load();
      }
      preloadedIdx = -1;

      // Show next, hide current — instant swap
      next.style.visibility = 'visible';
      next.play().catch(() => {
        trackTimeout(() => { if (mountedRef.current) next.play().catch(() => {}); }, 300);
      });

      // Hide and release old one after a tiny delay (lets the new one render first)
      trackTimeout(() => {
        if (!mountedRef.current) return;
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
      // Audit fix: bound the swap-on-error recursion. If every video fails,
      // synchronous onError → swapToNext → onError chains until stack overflow.
      consecutiveErrorCount++;
      if (consecutiveErrorCount > MAX_CONSECUTIVE_ERRORS) {
        console.warn('Too many consecutive video errors — falling back to canvas');
        if (mountedRef.current) setMode('canvas');
        return;
      }
      if (this === getActive()) swapToNext();
    }
    // Reset the consecutive-error counter when a video successfully plays.
    function onPlaying(this: HTMLVideoElement) {
      if (this === getActive()) consecutiveErrorCount = 0;
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
    va.addEventListener('playing', onPlaying);
    vb.addEventListener('playing', onPlaying);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(stallWatchdog);
      clearInterval(safetyInterval);
      // Audit fix: clear every tracked setTimeout so late-firing callbacks
      // don't touch torn-down elements / call setState after unmount.
      for (const t of pendingTimeouts) clearTimeout(t);
      pendingTimeouts.length = 0;
      va.removeEventListener('timeupdate', onTimeUpdate);
      vb.removeEventListener('timeupdate', onTimeUpdate);
      va.removeEventListener('ended', onEnded);
      vb.removeEventListener('ended', onEnded);
      va.removeEventListener('error', onError);
      vb.removeEventListener('error', onError);
      va.removeEventListener('playing', onPlaying);
      vb.removeEventListener('playing', onPlaying);
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
        {/* Dark background visible until first video frame is decoded */}
        {!videoReady && (
          <div className="absolute inset-0 bg-[#0a0e1a] z-10" />
        )}
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
