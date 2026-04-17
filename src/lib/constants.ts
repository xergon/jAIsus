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

// ElevenLabs voice options for settings dropdown
export const VOICE_OPTIONS = [
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', desc: 'Deep British' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', desc: 'Warm narrator' },
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', desc: 'Calm, gentle' },
  { id: 'GBv7mTt0atIp3Br8iCZE', name: 'Callum', desc: 'Transatlantic' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum II', desc: 'Deep warm' },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', desc: 'Deep, wise' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', desc: 'Warm Australian' },
  { id: 'D38z5RcWu1voky8WS1ja', name: 'Fin', desc: 'Irish warmth' },
  { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', desc: 'Calm American' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', desc: 'Casual warm' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', desc: 'Warm British' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', desc: 'Deep calm' },
] as const;

export const DEFAULT_VOICE_ID = 'ErXwobaYiN019PkySvjV'; // Antoni

// Flash model for ultra-low latency (~75ms vs ~300ms for multilingual_v2)
export const ELEVENLABS_MODEL_ID = 'eleven_flash_v2_5';

// Voice settings tuned for warm, slightly loose, divine delivery
export const TTS_SETTINGS = {
  stability: 0.60,          // A bit lower = more expressive, slightly unpredictable (tipsy vibe)
  similarity_boost: 0.80,   // High fidelity to voice
  style: 0.45,              // Higher expressiveness for character
  use_speaker_boost: true,  // Clearer audio
};
