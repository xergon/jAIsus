export const TEACHING_TOPICS = [
  { id: 'love', label: 'Love', icon: '❤️' },
  { id: 'forgiveness', label: 'Forgiveness', icon: '🕊️' },
  { id: 'faith', label: 'Faith', icon: '✝️' },
  { id: 'hope', label: 'Hope', icon: '🌅' },
  { id: 'patience', label: 'Patience', icon: '⏳' },
  { id: 'gratitude', label: 'Gratitude', icon: '🙏' },
  { id: 'compassion', label: 'Compassion', icon: '💛' },
  { id: 'wisdom', label: 'Wisdom', icon: '📖' },
] as const;

// ElevenLabs voice configuration
// Tested voices:
//   "pNInz6obpgDQGcFmaJgB" — "Adam" — US accent (too American)
//   "TX3LPaxmHKxFdv7VOQHJ" — "Liam" — warm British male
//   "ErXwobaYiN019PkySvjV" — "Antoni" — deep calm male
//   "JBFqnCBsd6RMkjVDRZzb" — "George" — warm British narrator
//   "onwK4e9ZLuTAKqWW03F9" — "Daniel" — deep British, authoritative warmth
export const ELEVENLABS_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9'; // "Daniel" — deep British

// Use the most expressive, highest-quality model
export const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';

// Voice settings tuned for warm, slightly loose, divine delivery
export const TTS_SETTINGS = {
  stability: 0.60,          // A bit lower = more expressive, slightly unpredictable (tipsy vibe)
  similarity_boost: 0.80,   // High fidelity to voice
  style: 0.45,              // Higher expressiveness for character
  use_speaker_boost: true,  // Clearer audio
};
