'use client';

import type { VoiceState } from '@/lib/types';
import type { Emotion } from '@/lib/emotions';
import { AnimatedJesus } from './AnimatedJesus';

interface HeroSectionProps {
  voiceState: VoiceState;
  interimTranscript?: string;
  emotion?: Emotion;
}

/**
 * Hero section — Jesus dominates the top, fades into WHITE content area below.
 * Extended +60px with softer gradient blend.
 */
export function HeroSection({ voiceState, interimTranscript, emotion }: HeroSectionProps) {
  return (
    <div className="relative w-full overflow-hidden" style={{ height: '72svh', maxHeight: '660px', minHeight: '420px' }}>
      {/* ===== BACKGROUND: Jesus video/image fills hero ===== */}
      <div className="absolute inset-0 z-0">
        <AnimatedJesus isSpeaking={voiceState === 'speaking'} emotion={emotion} />
      </div>

      {/* ===== Top gradient — dark, for title readability over starfield ===== */}
      <div
        className="absolute inset-x-0 top-0 z-[1] pointer-events-none"
        style={{
          height: '30%',
          background: 'linear-gradient(to bottom, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.4) 50%, transparent 100%)',
        }}
      />

      {/* ===== Bottom gradient — fades to WHITE, soft and extended ===== */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[2] pointer-events-none"
        style={{
          height: '35%',
          background: 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.9) 20%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0.15) 75%, transparent 100%)',
        }}
      />

      {/* ===== OVERLAY UI ===== */}
      <div className="relative z-10 flex flex-col items-center w-full h-full">

        {/* Starfield — top area */}
        <div className="absolute inset-x-0 top-0 h-36 overflow-hidden pointer-events-none">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white animate-pulse"
              style={{
                width: `${1 + (i % 3)}px`,
                height: `${1 + (i % 3)}px`,
                left: `${(i * 37 + 13) % 100}%`,
                top: `${(i * 23 + 7) % 100}%`,
                animationDelay: `${i * 0.15}s`,
                animationDuration: `${2 + (i % 4)}s`,
                opacity: 0.15 + (i % 5) * 0.08,
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
                const baseH = 6 + Math.sin(i * 0.8) * 14 + Math.cos(i * 1.3) * 8;
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
                const baseH = 4 + Math.abs(Math.sin(i * 0.7)) * 20;
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

        {/* Interim transcript */}
        {voiceState === 'listening' && interimTranscript && (
          <div className="mb-6 max-w-xs animate-fade-in">
            <p className="text-sm text-blue-100 italic text-center bg-black/30 backdrop-blur-sm rounded-xl px-4 py-2 border border-blue-300/20">
              &ldquo;{interimTranscript}&rdquo;
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
