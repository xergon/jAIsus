/**
 * Emotion → video mapping for emotion-matched playback.
 * The AI prefixes each sentence with [EMOTION:tag] which we strip and use
 * to pick the right video clip for AnimatedJesus.
 */

export type Emotion =
  | 'love'
  | 'warmth'
  | 'prayer'
  | 'anger'
  | 'sadness'
  | 'disapproval'
  | 'encouragement'
  | 'wonder'
  | 'neutral';

/** Map each emotion to its preferred video file(s), in priority order. */
export const EMOTION_VIDEO_MAP: Record<Emotion, string[]> = {
  love:          ['/jaisus-embraces.mp4', '/jaisus-loves-you.mp4'],
  warmth:        ['/jaisus-loves-you.mp4', '/jaisus-embraces.mp4'],
  prayer:        ['/jaisus-prays.mp4'],
  anger:         ['/jAisus-angry.mp4'],
  sadness:       ['/jAisus-suffers.mp4', '/jaisus-prays.mp4'],
  disapproval:   ['/jAisus-shakinghead.mp4'],
  encouragement: ['/jAisus_thumps_up.mp4', '/jaisus-loves-you.mp4'],
  wonder:        ['/jaisus-prays.mp4', '/jaisus-loves-you.mp4'],
  neutral:       ['/jaisus-loves-you.mp4', '/jaisus-prays.mp4'],
};

/**
 * Alias map: the AI might use natural variants like "angry" instead of "anger",
 * "compassionate" instead of "love", etc. Map them all to canonical emotions.
 */
const EMOTION_ALIASES: Record<string, Emotion> = {
  // Canonical (exact matches)
  love: 'love', warmth: 'warmth', prayer: 'prayer', anger: 'anger',
  sadness: 'sadness', disapproval: 'disapproval', encouragement: 'encouragement',
  wonder: 'wonder', neutral: 'neutral',
  // Common variants
  angry: 'anger', furious: 'anger', outrage: 'anger', outraged: 'anger',
  righteous: 'anger', indignant: 'anger', indignation: 'anger', wrath: 'anger',
  sad: 'sadness', sorrow: 'sadness', grief: 'sadness', mourning: 'sadness',
  pain: 'sadness', suffering: 'sadness', empathy: 'sadness', compassion: 'sadness',
  compassionate: 'love', loving: 'love', tender: 'love', tenderness: 'love',
  affection: 'love', embrace: 'love', comfort: 'love', comforting: 'love',
  warm: 'warmth', gentle: 'warmth', kind: 'warmth', kindness: 'warmth',
  friendly: 'warmth', welcoming: 'warmth', peaceful: 'warmth', calm: 'warmth',
  happy: 'warmth', joy: 'warmth', joyful: 'warmth', cheerful: 'warmth',
  proud: 'encouragement', encouraging: 'encouragement', support: 'encouragement',
  supportive: 'encouragement', inspire: 'encouragement', inspired: 'encouragement',
  inspiring: 'encouragement', hope: 'encouragement', hopeful: 'encouragement',
  approval: 'encouragement', affirming: 'encouragement',
  disapproving: 'disapproval', disappointed: 'disapproval', stern: 'disapproval',
  scolding: 'disapproval', warning: 'disapproval', rebuke: 'disapproval',
  playful: 'disapproval', teasing: 'disapproval', humor: 'disapproval',
  humorous: 'disapproval', funny: 'disapproval', amused: 'disapproval',
  prayerful: 'prayer', spiritual: 'prayer', reverent: 'prayer', solemn: 'prayer',
  blessing: 'prayer', sacred: 'prayer', divine: 'prayer', holy: 'prayer',
  awe: 'wonder', amazement: 'wonder', curious: 'wonder', curiosity: 'wonder',
  mystical: 'wonder', cosmic: 'wonder', profound: 'wonder', contemplative: 'wonder',
  reflective: 'wonder', philosophical: 'wonder', wondrous: 'wonder',
};

/** Resolve a raw tag string to a canonical Emotion, handling aliases and case. */
function resolveEmotion(raw: string): Emotion | null {
  const lower = raw.toLowerCase().trim();
  return EMOTION_ALIASES[lower] ?? null;
}

/**
 * Parse and strip the emotion tag from a text fragment (sentence or full response).
 * Case-insensitive, supports aliases like "angry" → anger.
 */
export function parseEmotionTag(text: string): { emotion: Emotion; cleanText: string } {
  const match = text.match(/^\s*\[EMOTION:\s*(\w+)\s*\]\s*/i);
  if (match) {
    const resolved = resolveEmotion(match[1]);
    if (resolved) {
      return { emotion: resolved, cleanText: text.replace(match[0], '') };
    }
  }
  return { emotion: 'neutral', cleanText: text };
}

/**
 * Strip ALL emotion tags from a full response (for display purposes).
 * Returns the clean text and the last emotion found.
 */
export function stripAllEmotionTags(text: string): { lastEmotion: Emotion; cleanText: string } {
  let lastEmotion: Emotion = 'neutral';
  const cleanText = text.replace(/\[EMOTION:\s*(\w+)\s*\]\s*/gi, (_match, tag: string) => {
    const resolved = resolveEmotion(tag);
    if (resolved) {
      lastEmotion = resolved;
    }
    return '';
  });
  return { lastEmotion, cleanText };
}
