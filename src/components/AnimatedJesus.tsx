'use client';

import { useEffect, useRef, useState } from 'react';
import { EMOTION_FALLBACK, EMOTION_VIDEO_MAP, IDLE_CLIPS, type Emotion, type HeroState } from '@/lib/emotions';

interface AnimatedJesusProps {
  /** Not used yet; if a speaking visual is added, read it through a ref so the canvas animation doesn't restart. */
  isSpeaking?: boolean;
  emotion?: Emotion;
  /** Listening / thinking while it lasts: shown with that emotion's clips,
   *  but never latched like an emotion, and its clip heads back to rest as
   *  soon as the state is over. */
  state?: HeroState | null;
  /** Changes when the reply is interrupted: drops an emotion still waiting
   *  for its clip, so the interrupted reply doesn't act on after it stopped. */
  cancelKey?: number;
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

// An older clip, made from a different base image (the face changes at a
// cut), so no emotion maps to it: only played when nothing mapped loads.
const LEGACY_FALLBACK = '/jaisus-loves-you-1080.mp4';

// Every clip, idle ones first: the session starts on VIDEO_PLAYLIST[0].
const VIDEO_PLAYLIST = Array.from(new Set([
  ...EMOTION_VIDEO_MAP.neutral,
  ...Object.values(EMOTION_VIDEO_MAP).flat(),
  LEGACY_FALLBACK,
]));

// Probed at startup to decide between video and the portrait. Only a few:
// each probe briefly holds a decoder (iOS allows very few), and the other
// clips are checked when they first play — one that fails is skipped for a
// while. The legacy clip covers a deploy where the idle clips are missing.
const PROBE_CLIPS = [...EMOTION_VIDEO_MAP.neutral, LEGACY_FALLBACK];

// With no idle clip playable, the hero rests on these, not on whatever clip
// comes next (anger, suffering).
const CALM_EMOTIONS: Emotion[] = ['peace', 'warmth', 'prayer', 'love'];

// Stop playback at 7s16f (7.667s) out of 8s clips — last 8 frames skipped in playback.
const SKIP_END_SECONDS = 0.333;

// The idle clips are at the rest pose only in their first 0.5 s and last
// 1.5 s (in between the head turns or the heart glow flares; measured against
// frame 0). A new emotion cuts in only there, or the pose jumps.
const IDLE_CUT_HEAD = 0.5;
const IDLE_CUT_TAIL = 1.5;

// 'thinking' interrupts an idle clip only once the reply takes this long, so
// a fast reply never starts the pondering clip.
const THINKING_DELAY_MS = 1500;

// A clip that failed to load is skipped for a while (a network blip, a
// decoder iOS took back), twice as long each time it fails again (a clip
// that isn't deployed), up to 32 minutes.
const FAIL_RETRY_MS = 60_000;

export function AnimatedJesus({ emotion = 'neutral', state = null, cancelKey = 0 }: AnimatedJesusProps) {
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
  // Persistent emotion — every swap consults this to pick the next video.
  // The state while there is one, else the emotion prop.
  const currentEmotionRef = useRef<Emotion>('neutral');
  // Latest non-neutral emotion not yet shown. The emotion is only read at clip
  // boundaries (~every 7.5s), and ChatInterface resets it to neutral as soon
  // as speech ends — often before the next boundary, so the emotion clip was
  // never picked. Consumed by the swap that plays it. States never go here:
  // they end, and must not hold back (or overwrite) a reply's emotion.
  const pendingEmotionRef = useRef<Emotion | null>(null);
  const stateRef = useRef<HeroState | null>(null);
  const emotionPropRef = useRef<Emotion>('neutral');
  // Set by the playback engine: starts the pending emotion (or the state) now
  // if the clip on screen is an idle one near the rest pose, else as soon as
  // it is back there (see IDLE_CUT_HEAD). Emotion clips still finish first.
  const interruptIdleRef = useRef<(() => void) | null>(null);
  // Set by the playback engine: a clip on screen for a state that is over, or
  // with a reply's emotion waiting, heads back to the rest pose early.
  const releaseStateClipRef = useRef<(() => void) | null>(null);

  // An interrupted reply's emotion that hasn't started yet is dropped.
  useEffect(() => {
    if (cancelKey) pendingEmotionRef.current = null;
  }, [cancelKey]);

  // Keep the refs in sync with the props
  useEffect(() => {
    emotionPropRef.current = emotion;
    if (!stateRef.current) currentEmotionRef.current = emotion;
    if (emotion !== 'neutral') {
      pendingEmotionRef.current = emotion;
      releaseStateClipRef.current?.();
      interruptIdleRef.current?.();
    }
  }, [emotion]);

  useEffect(() => {
    stateRef.current = state;
    currentEmotionRef.current = state ?? emotionPropRef.current;
    releaseStateClipRef.current?.();
    if (state === 'listening') interruptIdleRef.current?.();
    if (state !== 'thinking') return;
    const t = setTimeout(() => {
      if (stateRef.current === 'thinking') interruptIdleRef.current?.();
    }, THINKING_DELAY_MS);
    return () => clearTimeout(t);
  }, [state]);

  // Detect available videos on mount.
  //
  // CRITICAL: each probe video element holds a real decoder slot. iOS Safari
  // caps active decoders at ~16, often allows only 1 at a time. Previously
  // the 7 probes were never released and could block real playback. Now we:
  //  1. Release each probe's src as soon as metadata fires (or errors).
  //  2. Track all probes so cleanup can release any still hanging.
  //  3. Guard `done()` and the safety timeout against calling setState on an
  //     unmounted component.
  useEffect(() => {
    mountedRef.current = true;
    const found: string[] = [];
    let checked = 0;
    let finalized = false;
    const probes: HTMLVideoElement[] = [];
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
      if (finalized || !mountedRef.current) return;
      finalized = true;
      if (found.length > 0) {
        // Probed clips that failed are left out; the rest are assumed to
        // load and are skipped later if they don't. A clip known to load
        // comes first (the session starts on it): the legacy one when the
        // idle clips are missing.
        videosRef.current = [
          ...VIDEO_PLAYLIST.filter(v => found.includes(v)),
          ...VIDEO_PLAYLIST.filter(v => !PROBE_CLIPS.includes(v)),
        ];
        setMode('video');
      } else {
        // The portrait effect below loads the image (canvas if that fails too)
        setMode('image');
      }
    }

    // A clip whose metadata arrives after the 4s cutoff used to be dropped for
    // the whole session (an anger reply then got the embrace clip, or no video
    // at all). Add it now instead.
    function addLateVideo(src: string) {
      if (!mountedRef.current) return;
      if (videosRef.current.length > 0) {
        // Mutate in place: the playback engine holds this array. Appending
        // keeps the clip indices it has stored valid.
        if (!videosRef.current.includes(src)) videosRef.current.push(src);
      } else {
        // The cutoff found nothing and fell back to the portrait — switch to video
        videosRef.current = [src, ...VIDEO_PLAYLIST.filter(v => v !== src)];
        setMode('video');
      }
    }

    PROBE_CLIPS.forEach(src => {
      const v = document.createElement('video');
      probes.push(v);
      v.preload = 'metadata';
      v.muted = true; // Safari sometimes refuses metadata load on unmuted off-document elements
      v.src = src;
      v.onloadedmetadata = () => {
        found.push(src);
        checked++;
        releaseProbe(v);
        if (finalized) addLateVideo(src);
        else if (checked === PROBE_CLIPS.length) done();
      };
      v.onerror = () => {
        checked++;
        releaseProbe(v);
        if (checked === PROBE_CLIPS.length) done();
      };
    });

    detectTimeout = setTimeout(done, 4000);
    // Probes still silent after 30s are stuck — free their decoder slots
    const giveUpTimeout = setTimeout(() => probes.forEach(releaseProbe), 30000);

    return () => {
      mountedRef.current = false;
      if (detectTimeout) clearTimeout(detectTimeout);
      clearTimeout(giveUpTimeout);
      // Release any probes that haven't fired metadata yet
      probes.forEach(releaseProbe);
    };
  }, []);

  // Portrait fallback: used when no clip is found, and when video fails at
  // runtime (previously that went straight to the canvas with no Jesus).
  // A mode change (e.g. a late clip switching to video) detaches the handlers,
  // so a slow image load can't override it.
  useEffect(() => {
    if (mode !== 'image' || imageRef.current) return;
    const tryImages = ['/jesus-portrait.jpg', '/jesus-portrait.png'];
    let img: HTMLImageElement | null = null;
    function tryNextImage(i: number) {
      if (i >= tryImages.length) { setMode('canvas'); setImageLoaded(true); return; }
      const probe = new Image();
      img = probe;
      probe.onload = () => {
        imageRef.current = probe;
        setImageLoaded(true);
      };
      probe.onerror = () => tryNextImage(i + 1);
      probe.src = tryImages[i];
    }
    tryNextImage(0);
    return () => {
      if (img) {
        img.onload = null;
        img.onerror = null;
      }
    };
  }, [mode]);

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

    // The emotion the clip just swapped in is for, until it plays: if it fails
    // to load, that emotion gets another clip or its fallback, not whatever
    // is current by then.
    let swapEmotion: Emotion | null = null;
    // The state the clip on screen was picked for (see releaseStateClipRef).
    let stateClip: HeroState | null = null;
    // An interrupt came mid-way through an idle clip: cut it near its end.
    let tailCutWanted = false;

    // Autoplay blocked (iOS Low Power Mode, Safari "Never Auto-Play"): the
    // stall watchdog used to swap clips every ~4s for the whole session.
    // Hold the current clip instead and resume it on the next tap.
    // touchstart isn't a user activation on iOS (touchend and click are).
    let autoplayBlocked = false;
    const GESTURE_EVENTS = ['touchend', 'click', 'keydown'];
    function removeGestureListeners() {
      GESTURE_EVENTS.forEach(e => document.removeEventListener(e, unlockPlayback, true));
    }
    function unlockPlayback() {
      removeGestureListeners();
      autoplayBlocked = false;
      getActive().play().catch(markBlocked);
      // WebKit lifts the restriction per element: prime the idle one too, or
      // the next swap is blocked again.
      const idle = getNext();
      idle.play().catch(() => {});
      idle.pause();
    }
    /** True if play() was refused for lack of a user gesture (not an AbortError from a src change). */
    function markBlocked(err: unknown): boolean {
      if ((err as { name?: string } | null)?.name !== 'NotAllowedError') return false;
      if (!autoplayBlocked) {
        autoplayBlocked = true;
        GESTURE_EVENTS.forEach(e =>
          document.addEventListener(e, unlockPlayback, { capture: true, passive: true })
        );
      }
      return true;
    }

    let revealed = false;
    // 'playing' = actually rendering frames (best signal)
    // 'resize' = video dimensions changed (fires when first frame decodes)
    // 'loadeddata' / 'canplay' = fallback for browsers that don't fire playing
    const REVEAL_EVENTS = ['playing', 'resize', 'loadeddata', 'canplay'];
    // Both slots: if the first clip fails, slot B takes over and must be able
    // to reveal (it used to play hidden until the 12s fallback).
    const slots = [va, vb];
    function removeRevealListeners() {
      for (const el of slots) REVEAL_EVENTS.forEach(e => el.removeEventListener(e, revealVideo));
    }
    function revealVideo() {
      if (revealed) return;
      // Only reveal once the ACTIVE video has actual dimensions AND is playing —
      // Chrome shows a distorted/zoomed first frame if we reveal too early.
      // Checking the active slot also keeps a preloading slot from revealing.
      const el = getActive();
      if (el.videoWidth === 0 || el.videoHeight === 0) {
        // Dimensions not ready yet — wait for next event
        return;
      }
      revealed = true;
      removeRevealListeners();
      if (!mountedRef.current) return;
      // Small delay lets Chrome finish compositing the frame with correct object-fit
      requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        getActive().style.visibility = 'visible';
        setVideoReady(true);
        // An emotion that arrived while loading (the welcome) plays now
        // rather than after the first idle clip (still within IDLE_CUT_HEAD).
        if (pendingEmotionRef.current) trackTimeout(() => interruptIdleRef.current?.(), 200);
      });
    }
    for (const el of slots) REVEAL_EVENTS.forEach(e => el.addEventListener(e, revealVideo));

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
      if (revealed) {
        clearInterval(safetyInterval);
        return;
      }
      safetyTries++;
      const active = getActive(); // whichever slot is playing, not just A
      if (active.videoWidth > 0 && active.videoHeight > 0) {
        clearInterval(safetyInterval);
        revealVideo();
      } else if (safetyTries >= 24) {
        // 12s gone and still no dimensions — give up on video, fall back
        clearInterval(safetyInterval);
        if (mountedRef.current) {
          console.warn('Video failed to decode after 12s — falling back to the portrait');
          setMode('image');
        }
      }
    }, 500);

    va.play().catch(e => {
      markBlocked(e);
      // Autoplay blocked — wait a beat then reveal the still frame
      trackTimeout(revealVideo, 300);
    });

    // Clips that failed to load, when and how often (see FAIL_RETRY_MS), and
    // when each clip last started (a counter), so an emotion with several
    // clips rotates through them.
    const failedClips = new Map<string, { at: number; count: number }>();
    const lastPlayed = new Map<string, number>();
    let playCounter = 0;

    function hasFailed(src: string): boolean {
      const f = failedClips.get(src);
      return f !== undefined && Date.now() - f.at < FAIL_RETRY_MS * Math.min(2 ** (f.count - 1), 32);
    }
    // Back online: whatever failed meanwhile may load now.
    function onOnline() {
      failedClips.clear();
    }

    function playableClips(emo: Emotion): string[] {
      return (EMOTION_VIDEO_MAP[emo] ?? []).filter(v => videos.includes(v) && !hasFailed(v));
    }

    /** Least recently played first; avoids repeating the clip on screen. */
    function byLastPlayed(candidates: string[], current: string | undefined): string {
      const pool = candidates.length > 1 ? candidates.filter(v => v !== current) : candidates;
      return [...pool].sort((a, b) => (lastPlayed.get(a) ?? -1) - (lastPlayed.get(b) ?? -1))[0];
    }

    /** Pick the best video index for the current emotion */
    function pickEmotionVideo(): number {
      // A latched emotion wins over a prop that has already gone back to neutral
      let emo: Emotion | undefined = pendingEmotionRef.current ?? currentEmotionRef.current;
      const current = videos[currentIndexRef.current];
      // Follow the fallback chain until an emotion has a playable clip
      for (let hops = 0; emo && hops < 8; hops++) {
        const candidates = playableClips(emo);
        if (candidates.length > 0) return videos.indexOf(byLastPlayed(candidates, current));
        emo = emo === 'neutral' ? undefined : (EMOTION_FALLBACK[emo] ?? 'neutral');
      }
      // No idle clip plays: rest on a calm clip
      const calm = CALM_EMOTIONS.flatMap(playableClips);
      if (calm.length > 0) return videos.indexOf(byLastPlayed(calm, current));
      // Nothing mapped is playable: the legacy clip, the clip on screen
      // again, else any clip that hasn't failed
      const legacy = videos.indexOf(LEGACY_FALLBACK);
      if (legacy !== -1 && !hasFailed(LEGACY_FALLBACK)) return legacy;
      if (current && !hasFailed(current)) return currentIndexRef.current;
      for (let i = 1; i <= videos.length; i++) {
        const idx = (currentIndexRef.current + i) % videos.length;
        if (!hasFailed(videos[idx])) return idx;
      }
      return (currentIndexRef.current + 1) % videos.length;
    }

    // Track which video index was loaded into the "next" slot during preload,
    // so swapToNext can detect if the user's emotion changed between preload
    // (at 80% of current clip) and the actual swap (at clip end). Without
    // this, swapToNext would play whatever was preloaded even though the
    // emotion may now want a different video.
    let preloadedIdx = -1;

    // Hide + release the outgoing clip only once the incoming one has a frame
    // on screen. A fixed 50ms delay left the hero black whenever the new clip
    // loaded slower (e.g. an emotion change reloading it at the boundary).
    // The fallback covers a frame the events missed (rAF doesn't run in a
    // hidden tab); without a frame it keeps waiting — hiding then left the
    // hero dark on a slow connection — until the give-up stops a stuck load
    // from keeping two decoders alive.
    let cancelPendingHide: (() => void) | null = null;
    function hideWhenNextPaints(current: HTMLVideoElement, next: HTMLVideoElement) {
      let raf = 0;
      const fallback = setTimeout(() => {
        if (next.readyState >= 2) finish();
      }, 1500);
      const giveUp = setTimeout(finish, 9000);
      function cancel() {
        next.removeEventListener('loadeddata', onFrame);
        next.removeEventListener('playing', onFrame);
        clearTimeout(fallback);
        clearTimeout(giveUp);
        cancelAnimationFrame(raf);
        if (cancelPendingHide === cancel) cancelPendingHide = null;
      }
      function finish() {
        cancel();
        // A later swap may have made `current` active again
        if (!mountedRef.current || current === getActive()) return;
        current.style.visibility = 'hidden';
        releaseVideo(current);
      }
      function onFrame() {
        if (raf || next.readyState < 2) return; // < HAVE_CURRENT_DATA: no frame yet
        // Two frames: by then the new clip has been painted at least once
        raf = requestAnimationFrame(() => { raf = requestAnimationFrame(finish); });
      }
      cancelPendingHide = cancel;
      next.addEventListener('loadeddata', onFrame);
      next.addEventListener('playing', onFrame);
      onFrame(); // a preloaded clip may already have its first frame
    }

    function preloadNext() {
      if (videos.length <= 1 || preloadedRef.current) return;
      // A hide still pending would release the element we preload into
      cancelPendingHide?.();
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
      // A hide still pending from the last swap targets the element we are
      // about to load into — drop it.
      cancelPendingHide?.();
      currentIndexRef.current = pickEmotionVideo();
      lastPlayed.set(videos[currentIndexRef.current], ++playCounter);
      // The latched emotion is consumed only here, when its clip starts —
      // not at the 80% preload, which would drop it again. Kept in
      // swapEmotion until the clip plays, in case it fails to load.
      swapEmotion = pendingEmotionRef.current;
      pendingEmotionRef.current = null;
      // Nothing latched: the clip is for the state, if there is one
      stateClip = swapEmotion ? null : stateRef.current;
      tailCutWanted = false;

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

      // Show next; current stays up (frozen on its last frame) until next paints
      next.style.visibility = 'visible';
      next.play().catch(e => {
        if (markBlocked(e)) return; // retrying can't help until a tap
        trackTimeout(() => { if (mountedRef.current) next.play().catch(markBlocked); }, 300);
      });

      activeSlotRef.current = activeSlotRef.current === 'A' ? 'B' : 'A';
      preloadedRef.current = false;

      hideWhenNextPaints(current, next);
    }

    function onTimeUpdate(this: HTMLVideoElement) {
      const active = getActive();
      if (this !== active) return;
      // Hidden, the clip is paused: a seek's timeupdate must not start the
      // next clip (and keep cycling and downloading clips) in the background.
      if (document.hidden) return;
      if (!this.duration || this.duration === Infinity) return;

      const progress = this.currentTime / this.duration;
      const remaining = this.duration - this.currentTime;
      // Something waits behind an idle clip: cut it once it's back near rest
      const cutIdle =
        (tailCutWanted || pendingEmotionRef.current !== null) &&
        IDLE_CLIPS.has(this.getAttribute('src') ?? '');

      // Preload at 80% — if there's an emotion request, preload THAT video
      if (progress > 0.8 || (cutIdle && remaining <= IDLE_CUT_TAIL + 1)) {
        preloadNext();
      }

      if (cutIdle && remaining <= IDLE_CUT_TAIL) {
        this.pause();
        swapToNext();
        return;
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
      // Skip this clip for a while (see FAIL_RETRY_MS)
      const src = this.getAttribute('src');
      if (src) failedClips.set(src, { at: Date.now(), count: (failedClips.get(src)?.count ?? 0) + 1 });
      // Audit fix: bound the swap-on-error recursion. If every video fails,
      // synchronous onError → swapToNext → onError chains until stack overflow.
      consecutiveErrorCount++;
      if (consecutiveErrorCount > MAX_CONSECUTIVE_ERRORS) {
        console.warn('Too many consecutive video errors — falling back to the portrait');
        if (mountedRef.current) setMode('image');
        return;
      }
      if (this === getActive()) {
        // Its emotion gets another clip or its fallback (the failed one is skipped)
        if (!pendingEmotionRef.current && swapEmotion) pendingEmotionRef.current = swapEmotion;
        swapToNext();
      }
    }
    // Reset the consecutive-error counter (and the autoplay block) when a
    // video successfully plays.
    function onPlaying(this: HTMLVideoElement) {
      if (this !== getActive()) return;
      consecutiveErrorCount = 0;
      // Its emotion is on screen: an error later on doesn't bring it back.
      swapEmotion = null;
      if (autoplayBlocked) {
        autoplayBlocked = false;
        removeGestureListeners();
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        getActive().pause();
      } else {
        // An emotion that arrived while hidden starts now
        if (pendingEmotionRef.current) interruptIdleRef.current?.();
        const active = getActive();
        if (active.src && active.paused) active.play().catch(markBlocked);
      }
    }

    // Stall watchdog
    let lastTime = 0;
    let stallCount = 0;
    const stallWatchdog = setInterval(() => {
      if (!mountedRef.current) return;
      const active = getActive();
      if (active.paused && !document.hidden) {
        if (autoplayBlocked) {
          // Waiting for a tap — swapping clips can't help, it only flickers
          stallCount = 0;
        } else {
          stallCount++;
          if (stallCount > 1) { swapToNext(); stallCount = 0; }
          else active.play().catch(e => { if (!markBlocked(e)) swapToNext(); });
        }
      } else if (active.currentTime === lastTime && !active.paused) {
        stallCount++;
        if (stallCount > 2) { swapToNext(); stallCount = 0; }
      } else {
        stallCount = 0;
      }
      lastTime = active.currentTime;
    }, 4000);

    // A new emotion shouldn't wait for an idle clip to finish (up to 8 s).
    // Every clip starts on the rest pose, which idle clips are at only near
    // their start and end: there the cut doesn't jump; mid-clip it waits for
    // the tail (onTimeUpdate). Emotion clips still play out. Not in a hidden
    // tab: that would start playback there (it runs on return instead).
    interruptIdleRef.current = () => {
      if (!revealed || autoplayBlocked || !mountedRef.current || document.hidden) return;
      const active = getActive();
      const src = active.getAttribute('src');
      if (!src || !IDLE_CLIPS.has(src)) return;
      const d = active.duration;
      if (d && isFinite(d) && active.currentTime > IDLE_CUT_HEAD && d - active.currentTime > IDLE_CUT_TAIL) {
        tailCutWanted = true;
        return;
      }
      active.pause();
      swapToNext();
    };

    // A clip picked for a state (listening, thinking) plays only while the
    // state lasts or until a reply's emotion is waiting. Keyframed clips go
    // rest → pose, then pose → rest: the mirrored moment shows nearly the
    // same pose on its way back, so seeking there heads back to rest without
    // a jump (past halfway it already is). A hard cut would jump.
    releaseStateClipRef.current = () => {
      if (!stateClip) return;
      if (stateClip === stateRef.current && !pendingEmotionRef.current) return;
      stateClip = null;
      const active = getActive();
      const play = playCounter;
      const seekBack = () => {
        // Still the same clip on screen (not one swapped in since)
        if (active !== getActive() || play !== playCounter) return;
        const d = active.duration;
        const t = active.currentTime;
        if (d && isFinite(d) && t < d / 2) active.currentTime = d - t;
      };
      // A state that ended before its clip loaded: as soon as it has a duration
      if (active.readyState >= 1) seekBack();
      else active.addEventListener('loadedmetadata', seekBack, { once: true });
    };
    lastPlayed.set(videos[0], ++playCounter);

    va.addEventListener('timeupdate', onTimeUpdate);
    vb.addEventListener('timeupdate', onTimeUpdate);
    va.addEventListener('ended', onEnded);
    vb.addEventListener('ended', onEnded);
    va.addEventListener('error', onError);
    vb.addEventListener('error', onError);
    va.addEventListener('playing', onPlaying);
    vb.addEventListener('playing', onPlaying);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);

    return () => {
      interruptIdleRef.current = null;
      releaseStateClipRef.current = null;
      window.removeEventListener('online', onOnline);
      clearInterval(stallWatchdog);
      clearInterval(safetyInterval);
      // Audit fix: clear every tracked setTimeout so late-firing callbacks
      // don't touch torn-down elements / call setState after unmount.
      for (const t of pendingTimeouts) clearTimeout(t);
      pendingTimeouts.length = 0;
      cancelPendingHide?.();
      removeRevealListeners();
      removeGestureListeners();
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
  }, [mode, imageLoaded]);

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
          // Keep the portrait's aspect ratio even before Tailwind finishes loading.
          style={{
            objectFit: 'cover',
            objectPosition: 'top',
            filter: 'brightness(1.05) contrast(1.02)',
          }}
        />
        <video
          ref={videoBRef}
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover object-top"
          style={{
            objectFit: 'cover',
            objectPosition: 'top',
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
        className="w-full h-full object-cover"
        // The fixed-size fallback used to stretch to every hero aspect ratio.
        style={{ objectFit: 'cover', imageRendering: 'auto' }}
      />
    </div>
  );
}
