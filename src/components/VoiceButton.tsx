'use client';

import type { VoiceState } from '@/lib/types';

interface VoiceButtonProps {
  voiceState: VoiceState;
  onStart: () => void;
  onStop: () => void;
  isSupported: boolean;
}

export function VoiceButton({ voiceState, onStart, onStop, isSupported }: VoiceButtonProps) {
  const isActive = voiceState === 'listening';
  const isBusy = voiceState === 'processing' || voiceState === 'speaking';

  const baseClasses = 'relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200 active:scale-95 shadow-lg';
  const stateClasses = isActive
    ? 'bg-red-500 text-white shadow-red-200 animate-pulse-ring'
    : isBusy
      ? 'bg-amber-500 text-white shadow-amber-200'
      : 'bg-teal-500 text-white shadow-teal-200 hover:bg-teal-600';
  const disabledClasses = !isSupported ? 'opacity-50 cursor-not-allowed' : '';

  return (
    <button
      onClick={isActive || isBusy ? onStop : onStart}
      disabled={!isSupported}
      className={`${baseClasses} ${stateClasses} ${disabledClasses}`}
      aria-label={isActive ? 'Stop listening' : isBusy ? 'Stop speaking' : 'Start listening'}
      suppressHydrationWarning
    >
      {isActive ? (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <rect x="4" y="4" width="12" height="12" rx="2" />
        </svg>
      ) : isBusy ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" fill="currentColor" />
          <circle cx="18" cy="16" r="3" fill="currentColor" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="1" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
      )}

      {isActive && (
        <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-ping opacity-75" />
      )}
    </button>
  );
}
