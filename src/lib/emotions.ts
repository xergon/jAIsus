/**
 * Emotion → video mapping for emotion-matched playback.
 * The AI prefixes each sentence with [EMOTION:tag] which we strip and use
 * to pick the right video clip for AnimatedJesus.
 *
 * Every clip starts and ends on the same resting pose (hands around the
 * glowing heart), so any clip can follow any other without a jump. The
 * clips under /emotions/ were generated from scripts/emotion-clips.json
 * (4K styleframes as keyframes, MiniMax H3 2K, encoded to 1080p).
 */

export const EMOTIONS = [
  'neutral',
  // warm
  'love', 'warmth', 'joy', 'amused', 'playful', 'welcome', 'gratitude', 'agreement', 'encouragement',
  // tender / spiritual
  'compassion', 'mercy', 'peace', 'prayer', 'blessing', 'wonder', 'surprise',
  // conversational states
  'listening', 'thinking',
  // heavy
  'concern', 'sadness', 'weeping', 'resolve', 'disapproval', 'anger',
] as const;

export type Emotion = (typeof EMOTIONS)[number];

/**
 * The conversation's state (he listens while you talk, thinks until his reply
 * starts). Shown with the clips of the emotion of the same name, but it ends
 * when the state does, while a reply's emotion plays once (AnimatedJesus).
 */
export type HeroState = Extract<Emotion, 'listening' | 'thinking'>;

const E = (id: string) => `/emotions/${id}.mp4`;

/**
 * Clips per emotion. With several, AnimatedJesus rotates through them so the
 * same reaction doesn't repeat back to back. 'neutral' clips are idle loops;
 * they are at the resting pose only in their first ~0.5 s and last ~1.5 s
 * (mid-clip the head turns or the heart glow flares), so the hero cuts away
 * from them for a new emotion only there.
 *
 * Only the /emotions/ clips: the older root clips (/jaisus-*-1080.mp4) were
 * made from a different base image, so the face changed at every cut to or
 * from them. AnimatedJesus keeps one as a last resort if none of these load.
 */
export const EMOTION_VIDEO_MAP: Record<Emotion, string[]> = {
  neutral:       [E('idle-breath'), E('idle-glance')],
  love:          [E('love-reach')],
  warmth:        [E('warmth-smile')],
  joy:           [E('joy-laugh')],
  amused:        [E('amused-chuckle')],
  playful:       [E('playful-wink')],
  welcome:       [E('welcome-arms')],
  gratitude:     [E('gratitude-bow')],
  agreement:     [E('agreement-nod')],
  encouragement: [E('encouragement-fist')],
  compassion:    [E('compassion-tender')],
  mercy:         [E('mercy-palms')],
  peace:         [E('peace-serene')],
  prayer:        [E('prayer-hands')],
  blessing:      [E('blessing-hand')],
  wonder:        [E('wonder-sky')],
  surprise:      [E('surprise-delight')],
  listening:     [E('listening-attentive')],
  thinking:      [E('thinking-ponder')],
  concern:       [E('concern-caring')],
  sadness:       [E('sadness-down')],
  weeping:       [E('weeping-tear')],
  resolve:       [E('resolve-strength')],
  disapproval:   [E('disapproval-finger')],
  anger:         [E('anger-stern')],
};

/** Idle clips: may be cut short for a new emotion, near their start or end
 *  only (see EMOTION_VIDEO_MAP); emotion clips always play out. */
export const IDLE_CLIPS: ReadonlySet<string> = new Set(EMOTION_VIDEO_MAP.neutral);

/**
 * When an emotion has no playable clip (not generated yet, or failed to
 * load), the nearest one in feel is used instead. 'neutral' ends every chain.
 */
export const EMOTION_FALLBACK: Partial<Record<Emotion, Emotion>> = {
  amused: 'joy', playful: 'amused', joy: 'warmth', welcome: 'warmth', gratitude: 'peace',
  agreement: 'warmth', encouragement: 'warmth', compassion: 'love', mercy: 'compassion',
  peace: 'prayer', blessing: 'prayer', wonder: 'peace', surprise: 'joy', listening: 'warmth',
  thinking: 'wonder', concern: 'compassion', weeping: 'sadness', sadness: 'compassion',
  resolve: 'encouragement', disapproval: 'concern', anger: 'disapproval', love: 'warmth',
  warmth: 'neutral', prayer: 'neutral',
};

/**
 * Alias map: the AI might use natural variants like "angry" instead of "anger",
 * "compassionate" instead of "compassion", etc. Map them all to canonical emotions.
 */
const EMOTION_ALIASES: Record<string, Emotion> = {
  ...Object.fromEntries(EMOTIONS.map(e => [e, e])),
  // warm
  loving: 'love', tender: 'love', tenderness: 'love', affection: 'love', embrace: 'love', adoring: 'love',
  warm: 'warmth', gentle: 'warmth', kind: 'warmth', kindness: 'warmth', friendly: 'warmth',
  smile: 'warmth', smiling: 'warmth', content: 'warmth',
  happy: 'joy', joyful: 'joy', laugh: 'joy', laughing: 'joy', laughter: 'joy', delight: 'joy',
  delighted: 'joy', cheerful: 'joy', glad: 'joy', excited: 'joy', excitement: 'joy', celebration: 'joy',
  amusement: 'amused', humor: 'amused', humorous: 'amused', funny: 'amused', chuckle: 'amused',
  wry: 'amused', witty: 'amused', ironic: 'amused', sarcastic: 'amused', dry: 'amused',
  teasing: 'playful', cheeky: 'playful', wink: 'playful', mischievous: 'playful', flirty: 'playful',
  welcoming: 'welcome', greeting: 'welcome', hello: 'welcome', inviting: 'welcome',
  grateful: 'gratitude', thankful: 'gratitude', thanks: 'gratitude', humble: 'gratitude', humility: 'gratitude',
  agree: 'agreement', agreeing: 'agreement', yes: 'agreement', approval: 'agreement', approving: 'agreement',
  affirming: 'agreement', affirmation: 'agreement', nod: 'agreement', understanding: 'agreement',
  proud: 'encouragement', encouraging: 'encouragement', support: 'encouragement', supportive: 'encouragement',
  inspire: 'encouragement', inspired: 'encouragement', inspiring: 'encouragement', hope: 'encouragement',
  hopeful: 'encouragement', confident: 'encouragement', motivating: 'encouragement',
  // tender / spiritual
  compassionate: 'compassion', empathy: 'compassion', empathetic: 'compassion', comfort: 'compassion',
  comforting: 'compassion', caring: 'compassion', soothing: 'compassion', consoling: 'compassion',
  merciful: 'mercy', forgiving: 'mercy', forgiveness: 'mercy', grace: 'mercy', gracious: 'mercy', pardon: 'mercy',
  peaceful: 'peace', calm: 'peace', serene: 'peace', serenity: 'peace', tranquil: 'peace', still: 'peace',
  stillness: 'peace', relaxed: 'peace', zen: 'peace', meditative: 'peace',
  prayerful: 'prayer', praying: 'prayer', spiritual: 'prayer', reverent: 'prayer', solemn: 'prayer',
  sacred: 'prayer', holy: 'prayer', devout: 'prayer', worship: 'prayer',
  bless: 'blessing', blessed: 'blessing', benediction: 'blessing', divine: 'blessing',
  awe: 'wonder', amazement: 'wonder', amazed: 'wonder', curious: 'wonder', curiosity: 'wonder',
  mystical: 'wonder', cosmic: 'wonder', profound: 'wonder', wondrous: 'wonder', marvel: 'wonder',
  surprised: 'surprise', astonished: 'surprise', shocked: 'surprise', startled: 'surprise', wow: 'surprise',
  // conversational states
  listen: 'listening', attentive: 'listening', interested: 'listening', curiousness: 'listening',
  thoughtful: 'thinking', pondering: 'thinking', ponder: 'thinking', contemplative: 'thinking',
  reflective: 'thinking', reflecting: 'thinking', philosophical: 'thinking', considering: 'thinking',
  pensive: 'thinking', wise: 'thinking', wisdom: 'thinking', teaching: 'thinking', explaining: 'thinking',
  // heavy
  concerned: 'concern', worried: 'concern', worry: 'concern', anxious: 'concern', serious: 'concern',
  sad: 'sadness', sorrow: 'sadness', sorrowful: 'sadness', grief: 'sadness', mourning: 'sadness',
  pain: 'sadness', suffering: 'sadness', melancholy: 'sadness', heartbroken: 'sadness', depressed: 'sadness',
  weep: 'weeping', crying: 'weeping', tears: 'weeping', tearful: 'weeping', despair: 'weeping', anguish: 'weeping',
  determined: 'resolve', determination: 'resolve', strong: 'resolve', strength: 'resolve', firm: 'resolve',
  resolute: 'resolve', courage: 'resolve', brave: 'resolve', fierce: 'resolve', commanding: 'resolve',
  disapproving: 'disapproval', disappointed: 'disapproval', stern: 'disapproval', scolding: 'disapproval',
  warning: 'disapproval', rebuke: 'disapproval', skeptical: 'disapproval', doubtful: 'disapproval',
  angry: 'anger', furious: 'anger', outrage: 'anger', outraged: 'anger', righteous: 'anger',
  indignant: 'anger', indignation: 'anger', wrath: 'anger', wrathful: 'anger', rage: 'anger',
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
 * Drops an [EMOTION:...] tag that is still arriving at the very end of the
 * text ("My child. [EMOTION:wa"), or that was cut off by the token limit.
 * Bounded to the same 40 characters as a whole tag, so a tag that is never
 * closed shows up again instead of hiding the rest of the reply. Anchored at
 * the end, so the text before it stays the same once the tag completes (the
 * TTS sentence offsets in ChatInterface rely on that).
 */
export function stripTrailingEmotionTag(text: string): string {
  return text.replace(/\[(?:E(?:M(?:O(?:T(?:I(?:O(?:N(?::[^\]\[\n]{0,40})?)?)?)?)?)?)?)?$/i, '');
}

/** Where an emotion starts in the cleaned text (offset of the first character after its tag). */
export interface EmotionMark {
  at: number;
  emotion: Emotion;
}

/**
 * Strip ALL emotion tags from a full response (for display purposes).
 * Returns the clean text, the last emotion found, and where each tagged
 * emotion begins in the clean text (so speech can switch the hero's
 * expression sentence by sentence).
 */
export function stripAllEmotionTags(text: string): { lastEmotion: Emotion; cleanText: string; marks: EmotionMark[] } {
  let lastEmotion: Emotion = 'neutral';
  const marks: EmotionMark[] = [];
  let out = '';
  let last = 0;
  // Any tag text up to 40 chars ("warm-hearted", "righteous anger"), not just
  // one \w word: those used to stay in the bubble and be spoken. Bounded, and
  // never across a bracket or newline, so it can't swallow a later "[...]".
  for (const m of text.matchAll(/\[EMOTION:([^\]\[\n]{0,40})\]\s*/gi)) {
    out += text.slice(last, m.index);
    last = m.index + m[0].length;
    const tag = m[1];
    const resolved =
      resolveEmotion(tag) ?? resolveEmotion(tag.toLowerCase().split(/[^a-z]+/).find(Boolean) ?? '');
    if (resolved) {
      lastEmotion = resolved;
      marks.push({ at: out.length, emotion: resolved });
    }
  }
  out += text.slice(last);
  return { lastEmotion, cleanText: stripTrailingEmotionTag(out), marks };
}

/** The emotion in effect at `offset` of the clean text (the last tag at or before it). */
export function emotionAt(marks: readonly EmotionMark[], offset: number): Emotion | null {
  let found: Emotion | null = null;
  for (const m of marks) {
    if (m.at > offset) break;
    found = m.emotion;
  }
  return found;
}
