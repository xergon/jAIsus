/**
 * Mood-keyed content lookup.
 *
 * Sits beside the deterministic daily-* libraries: when a user says
 * "I'm anxious" / "I'm grateful" / "I'm grieving", we want to hand them
 * a curated bundle of (verse + kindness + parable + suggested prompt)
 * that matches the mood — not a random shuffle.
 *
 * Selection is the FIRST match in each underlying pool, which keeps the
 * mapping mood → content stable across renders, server/client, and reloads.
 * No Math.random — same mood always returns the same bundle.
 *
 * If nothing matches a mood's mapped themes/categories (e.g. data file
 * thinned out), we fall back to the first entry of the relevant pool so
 * callers always get a non-null result for verse / kindness.
 */
import { verses, type Verse } from './daily-verse';
import { ALL_KINDNESS_ACTS, type KindnessAct } from './daily-kindness';
import { parables } from './parables';
import { ALL_SUGGESTED_PROMPTS } from './suggested-prompts';

export type Mood =
  | 'anxious'
  | 'grateful'
  | 'sad'
  | 'angry'
  | 'lonely'
  | 'doubting'
  | 'hopeful'
  | 'overwhelmed'
  | 'peaceful'
  | 'lost';

export interface MoodInfo {
  id: Mood;
  label: string;
  emoji: string;
  /** Short empathic acknowledgment shown when the mood is picked. One sentence. */
  acknowledgment: string;
  /** Verse themes (matches `Verse.theme`) this mood pulls from, in priority order. */
  verseThemes: string[];
  /** Kindness categories (matches `KindnessAct.category`) this mood pulls from. */
  kindnessCategories: string[];
  /** Parable themes (matches entries of `Parable.themes`) this mood pulls from. */
  parableThemes: string[];
  /** Prompt categories (matches `SuggestedPrompt.category`) this mood pulls from. */
  promptCategories: string[];
}

export interface MoodContent {
  verse: Verse | null;
  kindness: KindnessAct | null;
  parableTitle: string | null;
  parableId: string | null;
  promptText: string | null;
}

/**
 * The 10 moods plus their mappings into the underlying content pools.
 *
 * Each entry is curated so the *first* matching item in each pool is a
 * thoughtful pairing, not just a literal theme hit. Order of
 * `verseThemes` / `parableThemes` / etc. matters — the first hit wins.
 */
export const MOODS: MoodInfo[] = [
  {
    id: 'anxious',
    label: 'Anxious',
    emoji: '🌬️',
    acknowledgment:
      "Anxiety is exhausting — let's slow it down together for a minute.",
    verseThemes: ['peace', 'rest', 'comfort'],
    kindnessCategories: ['self-care', 'presence'],
    parableThemes: ['trust', 'faith', 'hope'],
    promptCategories: ['feelings', 'reflection'],
  },
  {
    id: 'grateful',
    label: 'Grateful',
    emoji: '🙏',
    acknowledgment:
      "Gratitude is a gift — both to you and to whoever you direct it toward.",
    verseThemes: ['joy', 'love', 'faithfulness'],
    kindnessCategories: ['words', 'connection'],
    parableThemes: ['gratitude', 'joy', 'grace'],
    promptCategories: ['reflection', 'daily-life'],
  },
  {
    id: 'sad',
    label: 'Sad',
    emoji: '🤍',
    acknowledgment:
      "Sadness deserves space — you don't have to talk it away.",
    verseThemes: ['comfort', 'hope', 'love'],
    kindnessCategories: ['presence', 'self-care'],
    parableThemes: ['seeking', 'love', 'compassion'],
    promptCategories: ['feelings', 'reflection'],
  },
  {
    id: 'angry',
    label: 'Angry',
    emoji: '😤',
    acknowledgment:
      "Anger usually points to something that matters — let's look at what.",
    verseThemes: ['mercy', 'forgiveness', 'peace'],
    kindnessCategories: ['self-care', 'presence'],
    parableThemes: ['forgiveness', 'mercy', 'humility'],
    promptCategories: ['feelings', 'reflection'],
  },
  {
    id: 'lonely',
    label: 'Lonely',
    emoji: '🕯️',
    acknowledgment:
      "Loneliness is real, and it isn't a verdict on you — you're not as alone as it feels right now.",
    verseThemes: ['love', 'comfort', 'faithfulness'],
    kindnessCategories: ['connection', 'words'],
    parableThemes: ['seeking', 'love', 'compassion'],
    promptCategories: ['feelings', 'reflection'],
  },
  {
    id: 'doubting',
    label: 'Doubting',
    emoji: '🌫️',
    acknowledgment:
      "Doubt isn't the opposite of faith — it's part of how faith stays honest.",
    verseThemes: ['faith', 'trust', 'hope'],
    kindnessCategories: ['self-care', 'presence'],
    parableThemes: ['faith', 'seeking', 'trust'],
    promptCategories: ['doubts', 'big-questions'],
  },
  {
    id: 'hopeful',
    label: 'Hopeful',
    emoji: '🌅',
    acknowledgment:
      "Hope is doing real work in you — protect it, but also share it.",
    verseThemes: ['hope', 'joy', 'strength'],
    kindnessCategories: ['words', 'connection'],
    parableThemes: ['hope', 'growth', 'faith'],
    promptCategories: ['reflection', 'daily-life'],
  },
  {
    id: 'overwhelmed',
    label: 'Overwhelmed',
    emoji: '🌊',
    acknowledgment:
      "Overwhelm is a signal, not a failing — let's pick just one small thing.",
    verseThemes: ['rest', 'peace', 'strength'],
    kindnessCategories: ['self-care', 'presence'],
    parableThemes: ['patience', 'trust', 'wisdom'],
    promptCategories: ['feelings', 'daily-life'],
  },
  {
    id: 'peaceful',
    label: 'Peaceful',
    emoji: '🌿',
    acknowledgment:
      "Peace is worth noticing out loud — sit in it for a beat before moving on.",
    verseThemes: ['peace', 'joy', 'contentment'],
    kindnessCategories: ['presence', 'connection'],
    parableThemes: ['joy', 'love', 'hope'],
    promptCategories: ['reflection', 'daily-life'],
  },
  {
    id: 'lost',
    label: 'Lost',
    emoji: '🧭',
    acknowledgment:
      "Lost isn't the same as forgotten — being found starts with admitting you don't know which way.",
    verseThemes: ['help', 'trust', 'hope'],
    kindnessCategories: ['self-care', 'connection'],
    parableThemes: ['seeking', 'repentance', 'grace'],
    promptCategories: ['big-questions', 'reflection'],
  },
];

/** Returns the MoodInfo for the given id, or `null` if not found. */
export function getMoodInfo(mood: Mood): MoodInfo | null {
  return MOODS.find((m) => m.id === mood) ?? null;
}

/**
 * Picks the first verse whose explicit `theme` matches any of `themes`.
 *
 * Themes are compared case-insensitively. If no verse has a matching
 * theme, falls back to the first verse whose `text` contains a theme
 * keyword (loose substring match). Returns `null` only if both passes
 * miss, which lets the caller apply a stable global fallback.
 */
function pickVerse(themes: string[]): Verse | null {
  const lowered = themes.map((t) => t.toLowerCase());
  // First pass: exact theme tag match.
  for (const v of verses) {
    if (v.theme && lowered.includes(v.theme.toLowerCase())) {
      return v;
    }
  }
  // Second pass: loose text match (useful for moods that lean on words
  // not present as a tag, e.g. "rest" hitting a verse tagged "peace").
  for (const v of verses) {
    const text = v.text.toLowerCase();
    if (lowered.some((t) => text.includes(t))) {
      return v;
    }
  }
  return null;
}

function pickKindness(categories: string[]): KindnessAct | null {
  const set = new Set(categories);
  for (const k of ALL_KINDNESS_ACTS) {
    if (set.has(k.category)) return k;
  }
  return null;
}

function pickParable(themes: string[]): {
  id: string;
  title: string;
} | null {
  const set = new Set(themes.map((t) => t.toLowerCase()));
  for (const p of parables) {
    if (p.themes.some((t) => set.has(t.toLowerCase()))) {
      return { id: p.id, title: p.title };
    }
  }
  return null;
}

// Starter prompt per mood, picked by id: the first prompt in a mapped
// category was "What does it mean to love my neighbor?" for 7 of 10 moods.
// Moods without a fitting prompt get null, and the chat sends
// "I'm feeling <mood>." instead.
const MOOD_PROMPT_IDS: Partial<Record<Mood, string>> = {
  anxious: 'f-anxious',
  angry: 'f-angry',
  lonely: 'f-alone',
  overwhelmed: 'f-overwhelmed',
  doubting: 'x-not-believing',
  lost: 'r-purpose',
};

function pickPrompt(mood: Mood): string | null {
  const id = MOOD_PROMPT_IDS[mood];
  return id ? ALL_SUGGESTED_PROMPTS.find((p) => p.id === id)?.text ?? null : null;
}

/**
 * Curated content set for a given mood.
 *
 * Each slot picks the first match against the mood's mapped
 * themes/categories. Slots that don't find a match fall back to the
 * first item of the relevant pool so verse/kindness are never null
 * when data is present. Parable may be `null` only if its pool is empty.
 * Prompt is `null` for moods with no fitting starter (see MOOD_PROMPT_IDS).
 */
export function getMoodContent(mood: Mood): MoodContent {
  const info = getMoodInfo(mood);
  if (!info) {
    return {
      verse: verses[0] ?? null,
      kindness: ALL_KINDNESS_ACTS[0] ?? null,
      parableTitle: parables[0]?.title ?? null,
      parableId: parables[0]?.id ?? null,
      promptText: ALL_SUGGESTED_PROMPTS[0]?.text ?? null,
    };
  }

  const verse = pickVerse(info.verseThemes) ?? verses[0] ?? null;
  const kindness =
    pickKindness(info.kindnessCategories) ?? ALL_KINDNESS_ACTS[0] ?? null;
  const parable = pickParable(info.parableThemes) ??
    (parables[0] ? { id: parables[0].id, title: parables[0].title } : null);
  const promptText = pickPrompt(mood);

  return {
    verse,
    kindness,
    parableTitle: parable?.title ?? null,
    parableId: parable?.id ?? null,
    promptText,
  };
}
