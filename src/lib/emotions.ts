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
  love:          ['/jAisus-embraces.mp4', '/jAisus-loves-you.mp4'],
  warmth:        ['/jAisus-loves-you.mp4', '/jAisus-embraces.mp4'],
  prayer:        ['/jAisus-prays.mp4'],
  anger:         ['/jAisus-angry.mp4'],
  sadness:       ['/jAisus-suffers.mp4', '/jAisus-prays.mp4'],
  disapproval:   ['/jAisus-shakinghead.mp4'],
  encouragement: ['/jAisus_thumps_up.mp4', '/jAisus-loves-you.mp4'],
  wonder:        ['/jAisus-prays.mp4', '/jAisus-loves-you.mp4'],
  neutral:       ['/jAisus-loves-you.mp4', '/jAisus-prays.mp4'],
};

const EMOTION_TAG_REGEX = /^\[EMOTION:(\w+)\]\s*/;

/**
 * Parse and strip the emotion tag from an AI response.
 * Returns the detected emotion and the clean text without the tag.
 */
export function parseEmotionTag(text: string): { emotion: Emotion; cleanText: string } {
  const match = text.match(EMOTION_TAG_REGEX);
  if (match) {
    const tag = match[1] as Emotion;
    const validEmotions: Emotion[] = [
      'love', 'warmth', 'prayer', 'anger', 'sadness',
      'disapproval', 'encouragement', 'wonder', 'neutral',
    ];
    if (validEmotions.includes(tag)) {
      return { emotion: tag, cleanText: text.replace(EMOTION_TAG_REGEX, '') };
    }
  }
  return { emotion: 'neutral', cleanText: text };
}
