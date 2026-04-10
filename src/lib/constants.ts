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
// "Adam" — deep, warm, calm male voice perfect for spiritual guidance
// Alternative premium voices to try:
//   "TX3LPaxmHKxFdv7VOQHJ" — "Liam" — warm British male
//   "ErXwobaYiN019PkySvjV" — "Antoni" — deep calm male
//   "VR6AewLTigWG4xSOukaG" — "Arnold" — deep authoritative
export const ELEVENLABS_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // "Adam"

// Use the most expressive, highest-quality model
export const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';

// Voice settings tuned for warm, calm, Jesus-like delivery
export const TTS_SETTINGS = {
  stability: 0.75,          // Higher = more consistent, calm
  similarity_boost: 0.85,   // High fidelity to the base voice
  style: 0.35,              // Moderate expressiveness
  use_speaker_boost: true,  // Clearer audio
};
