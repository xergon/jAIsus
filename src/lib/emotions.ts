/**
 * Emotion → video mapping for emotion-matched playback.
 * The AI prefixes each response with [EMOTION:tag] which we strip and use
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

const EMOTION_TAG_REGEX = /^\s*\[EMOTION:(\w+)\]\s*/;

const VALID_EMOTIONS: Emotion[] = [
  'love', 'warmth', 'prayer', 'anger', 'sadness',
  'disapproval', 'encouragement', 'wonder', 'neutral',
];

/**
 * Parse and strip the emotion tag from a text fragment (sentence or full response).
 * Returns the detected emotion and the clean text without the tag.
 */
export function parseEmotionTag(text: string): { emotion: Emotion; cleanText: string } {
  const match = text.match(EMOTION_TAG_REGEX);
  if (match && VALID_EMOTIONS.includes(match[1] as Emotion)) {
    return { emotion: match[1] as Emotion, cleanText: text.replace(EMOTION_TAG_REGEX, '') };
  }
  return { emotion: 'neutral', cleanText: text };
}

/**
 * Strip ALL emotion tags from a full response (for display purposes).
 * Returns the clean text and the last emotion found.
 */
export function stripAllEmotionTags(text: string): { lastEmotion: Emotion; cleanText: string } {
  const TAG_GLOBAL = /\[EMOTION:(\w+)\]\s*/g;
  let lastEmotion: Emotion = 'neutral';
  const cleanText = text.replace(TAG_GLOBAL, (_match, tag: string) => {
    if (VALID_EMOTIONS.includes(tag as Emotion)) {
      lastEmotion = tag as Emotion;
    }
    return '';
  });
  return { lastEmotion, cleanText };
}
