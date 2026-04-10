export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface Parable {
  id: string;
  title: string;
  reference: string;
  summary: string;
  fullText: string;
  themes: string[];
  suggestPrompt: string;
}

export interface PrayerRequest {
  id: string;
  text: string;
  timestamp: number;
}

export interface Teaching {
  id: string;
  topic: string;
  content: string;
  timestamp: number;
}

export type ActivePanel = 'none' | 'parables' | 'prayer' | 'teachings' | 'settings' | 'community';
