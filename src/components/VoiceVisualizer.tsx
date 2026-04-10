'use client';

import type { VoiceState } from '@/lib/types';

interface VoiceVisualizerProps {
  voiceState: VoiceState;
}

export function VoiceVisualizer({ voiceState }: VoiceVisualizerProps) {
  if (voiceState === 'idle') return null;

  const isListening = voiceState === 'listening';
  const isSpeaking = voiceState === 'speaking';
  const isProcessing = voiceState === 'processing';

  return (
    <div className="mt-4 flex flex-col items-center gap-2 animate-fade-in">
      {/* Waveform bars */}
      <div className="flex items-center gap-1 h-10">
        {isListening && (
          <>
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <div
                key={i}
                className="w-1 rounded-full bg-teal-400 voice-bar-listening"
                style={{
                  animationDelay: `${i * 0.1}s`,
                  height: '8px',
                }}
              />
            ))}
          </>
        )}
        {isSpeaking && (
          <>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (
              <div
                key={i}
                className="w-1.5 rounded-full bg-amber-500 voice-bar-speaking"
                style={{
                  animationDelay: `${i * 0.08}s`,
                  height: '6px',
                }}
              />
            ))}
          </>
        )}
        {isProcessing && (
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-teal-400 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status label */}
      <div className="flex items-center gap-2 text-sm">
        {isListening && (
          <span className="text-teal-600 font-medium">Listening...</span>
        )}
        {isSpeaking && (
          <>
            <span className="inline-block h-2 w-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-amber-700 font-medium">jAIsus Speaking...</span>
          </>
        )}
        {isProcessing && (
          <span className="text-stone-500 font-medium">Thinking...</span>
        )}
      </div>
    </div>
  );
}
