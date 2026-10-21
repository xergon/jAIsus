'use client';

import type { VoiceState } from '@/lib/types';
import type { Emotion, HeroState } from '@/lib/emotions';
import { AnimatedJesus } from './AnimatedJesus';

interface HeroSectionProps {
  voiceState: VoiceState;
  interimTranscript?: string;
  emotion?: Emotion;
  /** Listening / thinking, while it lasts (see AnimatedJesus). */
  heroState?: HeroState | null;
  /** Bumped when a reply is interrupted (see AnimatedJesus). */
  emotionCancelKey?: number;
}

// Perf audit fix: compute starfield positions ONCE at module load instead
// of allocating 20 new position objects on every re-render. During chat
// streaming HeroSection re-renders on every token; without this it was
// allocating + reformatting 20 style strings 60× per second.
const STARFIELD = Array.from({ length: 20 }, (_, i) => ({
  key: i,
  width: `${1 + (i % 3)}px`,
  height: `${1 + (i % 3)}px`,
  left: `${(i * 37 + 13) % 100}%`,
  top: `${(i * 23 + 7) % 100}%`,
  animationDelay: `${i * 0.15}s`,
  animationDuration: `${2 + (i % 4)}s`,
  opacity: 0.15 + (i % 5) * 0.08,
}));

const TRANSCRIPT_TAIL_CHARS = 160;

/** The last ~160 characters, starting at a word. */
function transcriptTail(text: string): string {
  if (text.length <= TRANSCRIPT_TAIL_CHARS) return text;
  const tail = text.slice(-TRANSCRIPT_TAIL_CHARS);
  return '…' + tail.replace(/^\S*\s+/, '');
}

/**
 * Hero section — Jesus dominates the top, fades into WHITE content area below.
 * Extended +60px with softer gradient blend.
 */
export function HeroSection({ voiceState, interimTranscript, emotion, heroState = null, emotionCancelKey = 0 }: HeroSectionProps) {
  // Audit fix: provide a `vh` fallback before `svh`. iOS Safari 15.0-15.3
  // doesn't know `svh` units; without the fallback the height resolves to 0
  // and the hero would collapse (the minHeight rescues it, but the intended
  // responsive sizing breaks). The Tailwind arbitrary class declares both
  // values via a feature query — modern browsers win with svh, old ones
  // keep vh.
  return (
    <div
      // Bug fix (user-reported "startscreen looks broken, need to scroll up"):
      // 85vh was too tall once the sticky bottom container grew to include
      // the personality switcher row (chips + create button) ABOVE the input
      // form + icon row. Total bottom = ~190px. On a 670-700px tall mobile
      // viewport (after browser chrome) the hero pushed the title above
      // the top edge and the page either clipped or required a scroll the
      // user wasn't expecting on a "voice-first" hero screen. Drop the
      // hero to 70vh on small viewports and let it grow back to 80vh on
      // taller screens via min-height. The maxHeight cap still applies.
      // `isolate` keeps the z-layers below inside the hero, so the sticky
      // bottom bar paints (and takes clicks) on top where the two overlap.
      className="relative isolate w-full overflow-hidden h-[70vh] [@supports(height:1svh)]:h-[70svh] sm:h-[80vh] sm:[@supports(height:1svh)]:h-[80svh]"
      style={{ maxHeight: '900px', minHeight: '380px' }}
    >
      {/* ===== BACKGROUND: Jesus video/image fills hero ===== */}
      <div className="absolute inset-0 z-0">
        <AnimatedJesus isSpeaking={voiceState === 'speaking'} emotion={emotion} state={heroState} cancelKey={emotionCancelKey} />
      </div>

      {/* ===== Top gradient — dark, for title readability over starfield ===== */}
      <div
        className="absolute inset-x-0 top-0 z-[1] pointer-events-none"
        style={{
          height: '30%',
          background: 'linear-gradient(to bottom, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.4) 50%, transparent 100%)',
        }}
      />

      {/* ===== Bottom gradient — 100px blend zone at bottom edge of video ===== */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[2] pointer-events-none"
        style={{
          height: '100px',
          background: 'linear-gradient(to top, rgba(250,250,249,1) 0%, rgba(250,250,249,0.85) 30%, rgba(250,250,249,0.4) 60%, transparent 100%)',
        }}
      />

      {/* ===== OVERLAY UI ===== */}
      <div className="relative z-10 flex flex-col items-center w-full h-full">

        {/* Starfield — top area (positions memoized at module scope) */}
        <div className="absolute inset-x-0 top-0 h-36 overflow-hidden pointer-events-none">
          {STARFIELD.map(s => (
            <div
              key={s.key}
              className="absolute rounded-full bg-white animate-pulse"
              style={{
                width: s.width,
                height: s.height,
                left: s.left,
                top: s.top,
                animationDelay: s.animationDelay,
                animationDuration: s.animationDuration,
                opacity: s.opacity,
              }}
            />
          ))}
        </div>

        {/* Halo */}
        <div className="relative w-12 h-5 mt-5 mb-1">
          <div className="w-full h-full rounded-[50%] border border-amber-300/60" style={{
            boxShadow: '0 0 15px rgba(217,119,6,0.3), inset 0 0 8px rgba(217,119,6,0.15)',
          }} />
        </div>

        {/* Title */}
        <h1 className="relative text-5xl font-bold text-white tracking-wider font-serif drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
          j<span className="text-amber-300 drop-shadow-[0_0_14px_rgba(251,191,36,0.5)]">AI</span>sus
        </h1>

        {/* AI badge — top right */}
        <div className="absolute top-6 right-4 flex items-center gap-1.5 bg-black/20 backdrop-blur-sm rounded-full px-3 py-1 border border-white/10">
          <span className={`w-2 h-2 rounded-full ${
            voiceState === 'speaking' || voiceState === 'processing'
              ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.6)]'
              : 'bg-emerald-400'
          }`} />
          <span className="text-xs text-white/80 font-semibold tracking-wide">AI</span>
        </div>

        {/* ===== Voice visualizers — bigger, blue wave left / gold bars right ===== */}
        <div className="relative flex items-start justify-between w-full px-5 mt-4">
          {/* Listening — blue sine wave style */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-[2px] h-12">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => {
                const baseH = Math.round(6 + Math.sin(i * 0.8) * 14 + Math.cos(i * 1.3) * 8);
                return (
                  <div
                    key={i}
                    className={`rounded-full transition-all duration-300 ${
                      voiceState === 'listening'
                        ? 'voice-bar-listening'
                        : ''
                    }`}
                    style={{
                      width: '3px',
                      height: `${Math.max(4, baseH)}px`,
                      background: voiceState === 'listening'
                        ? 'linear-gradient(to top, #60a5fa, #93c5fd)'
                        : 'rgba(147, 197, 253, 0.35)',
                      animationDelay: `${i * 0.08}s`,
                    }}
                  />
                );
              })}
            </div>
            <span className={`text-xs font-medium tracking-wide drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)] ${
              voiceState === 'listening' ? 'text-blue-300' : 'text-white/50'
            }`}>
              Listening...
            </span>
          </div>

          {/* Speaking — gold/amber bars, taller */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-end gap-[2px] h-12">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(i => {
                const baseH = Math.round(4 + Math.abs(Math.sin(i * 0.7)) * 20);
                return (
                  <div
                    key={i}
                    className={`rounded-full transition-all duration-200 ${
                      voiceState === 'speaking'
                        ? 'voice-bar-speaking'
                        : ''
                    }`}
                    style={{
                      width: '2.5px',
                      height: `${Math.max(3, baseH)}px`,
                      background: voiceState === 'speaking'
                        ? 'linear-gradient(to top, #d97706, #fbbf24)'
                        : 'rgba(217, 119, 6, 0.3)',
                      animationDelay: `${i * 0.05}s`,
                    }}
                  />
                );
              })}
            </div>
            <span className={`text-xs font-medium tracking-wide drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)] ${
              voiceState === 'speaking' ? 'text-amber-300' : 'text-white/50'
            }`}>
              jAIsus Speaking...
            </span>
          </div>
        </div>

        {/* Spacer — Jesus body/heart visible */}
        <div className="flex-1" />

        {/* Interim transcript: only the newest words, so a long dictation
            doesn't push them out of the hero, which clips its overflow. */}
        {voiceState === 'listening' && interimTranscript && (
          <div className="mb-6 max-w-xs animate-fade-in">
            <p className="text-sm text-blue-100 italic text-center bg-black/30 backdrop-blur-sm rounded-xl px-4 py-2 border border-blue-300/20 [overflow-wrap:anywhere]">
              &ldquo;{transcriptTail(interimTranscript)}&rdquo;
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
