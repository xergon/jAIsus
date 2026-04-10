'use client';

import { useState, useCallback } from 'react';
import type { VoiceState } from '@/lib/types';

export function useVoiceState() {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');

  const startListening = useCallback(() => setVoiceState('listening'), []);
  const startProcessing = useCallback(() => setVoiceState('processing'), []);
  const startSpeaking = useCallback(() => setVoiceState('speaking'), []);
  const reset = useCallback(() => setVoiceState('idle'), []);

  return {
    voiceState,
    setVoiceState,
    startListening,
    startProcessing,
    startSpeaking,
    reset,
  };
}
