// Keep this in sync with ALLOWED_TOPICS in /api/teachings/route.ts
export const TEACHING_TOPICS = [
  { id: 'love', label: 'Love', icon: '❤️' },
  { id: 'forgiveness', label: 'Forgiveness', icon: '🕊️' },
  { id: 'faith', label: 'Faith', icon: '✝️' },
  { id: 'hope', label: 'Hope', icon: '🌅' },
  { id: 'patience', label: 'Patience', icon: '⏳' },
  { id: 'gratitude', label: 'Gratitude', icon: '🙏' },
  { id: 'compassion', label: 'Compassion', icon: '💛' },
  { id: 'wisdom', label: 'Wisdom', icon: '📖' },
  { id: 'peace', label: 'Peace', icon: '☮️' },
  { id: 'courage', label: 'Courage', icon: '🦁' },
  { id: 'joy', label: 'Joy', icon: '✨' },
  { id: 'grief', label: 'Grief', icon: '🕯️' },
  { id: 'identity', label: 'Identity', icon: '🪞' },
  { id: 'calling', label: 'Calling', icon: '🧭' },
  { id: 'surrender', label: 'Surrender', icon: '🤲' },
  { id: 'friendship', label: 'Friendship', icon: '🤝' },
] as const;

// ElevenLabs voice options for settings dropdown. ElevenLabs now serves the
// "Fin" and "Callum" IDs as voices it calls "Peter" and "Tom"; the owner chose
// these by ear, so keep the IDs and the names users know them by.
export const VOICE_OPTIONS = [
  { id: '1NoaCvAMXHNFa4aZ7phm', name: 'jAIsus', desc: 'Palestinian baritone' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', desc: 'Warm narrator' },
  { id: 'D38z5RcWu1voky8WS1ja', name: 'Fin', desc: 'Irish warmth' },
  { id: 'GBv7mTt0atIp3Br8iCZE', name: 'Callum', desc: 'Transatlantic' },
] as const;

export const DEFAULT_VOICE_ID = '1NoaCvAMXHNFa4aZ7phm'; // jAIsus — Palestinian baritone

// Flash model for ultra-low latency (~75ms vs ~300ms for multilingual_v2)
export const ELEVENLABS_MODEL_ID = 'eleven_flash_v2_5';

// Voice settings tuned for warm, slightly loose, divine delivery
export const TTS_SETTINGS = {
  stability: 0.60,          // A bit lower = more expressive, slightly unpredictable (tipsy vibe)
  similarity_boost: 0.80,   // High fidelity to voice
  style: 0.45,              // Higher expressiveness for character
  use_speaker_boost: true,  // Clearer audio
};

// Voices that need another model than ELEVENLABS_MODEL_ID. "jAIsus — Palestinian
// baritone" was designed in the owner's ElevenLabs account with eleven_v3 and
// only sounds like itself on v3. v3 is slower (~1 s to first byte, a sentence
// in ~2-3 s), so useSpeechSynthesis fetches the next sentence while one plays.
// v3 takes stability 0, 0.5 or 1 and no style or speed.
export const VOICE_MODELS: Record<string, { modelId: string; settings: Record<string, number | boolean> }> = {
  '1NoaCvAMXHNFa4aZ7phm': { modelId: 'eleven_v3', settings: { stability: 0.5, similarity_boost: 0.8 } },
};
