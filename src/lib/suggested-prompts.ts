/**
 * Suggested Prompts — curated starter questions for the empty chat state.
 *
 * Shows a small rotating set of tappable suggestion chips so first-time users
 * (and users who just cleared their history) have an on-ramp into conversation
 * without having to think of something to ask.
 *
 * Selection is deterministic per UTC calendar day (same scheme as
 * `daily-verse.ts`) so server and client agree (no hydration mismatch) and
 * every user sees the same chips on the same day.
 */
import { dayOfYear } from './daily-verse';

export interface SuggestedPrompt {
  id: string;
  text: string;
  /** Optional emoji or short icon shown on the chip */
  icon?: string;
  /** Loose category — for variety, not display */
  category:
    | 'reflection'
    | 'parable'
    | 'daily-life'
    | 'big-questions'
    | 'feelings'
    | 'doubts';
}

/**
 * Full pool of curated prompts. ~30 entries, 5 per category.
 * Tone: conversational, real, not churchy — things a real person actually thinks.
 */
export const ALL_SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  // ── Reflection ────────────────────────────────────────────────────────────
  {
    id: 'r-love-neighbor',
    text: 'What does it mean to love my neighbor?',
    icon: '🤝',
    category: 'reflection',
  },
  {
    id: 'r-forgive-hurt',
    text: 'How can I forgive someone who really hurt me?',
    icon: '💔',
    category: 'reflection',
  },
  {
    id: 'r-point-of-suffering',
    text: "What's the point of suffering?",
    icon: '🌧️',
    category: 'reflection',
  },
  {
    id: 'r-purpose',
    text: 'How do I figure out what I should do with my life?',
    icon: '🧭',
    category: 'reflection',
  },
  {
    id: 'r-enough',
    text: 'How do I know if I am enough?',
    icon: '🪞',
    category: 'reflection',
  },

  // ── Parable ──────────────────────────────────────────────────────────────
  {
    id: 'p-prodigal-son',
    text: 'Tell me about the Prodigal Son',
    icon: '📖',
    category: 'parable',
  },
  {
    id: 'p-mustard-seed',
    text: "What's the Mustard Seed parable?",
    icon: '🌱',
    category: 'parable',
  },
  {
    id: 'p-good-samaritan',
    text: 'Explain the Good Samaritan',
    icon: '🛤️',
    category: 'parable',
  },
  {
    id: 'p-lost-sheep',
    text: 'What does the Lost Sheep story mean?',
    icon: '🐑',
    category: 'parable',
  },
  {
    id: 'p-talents',
    text: 'Tell me about the parable of the talents',
    icon: '💰',
    category: 'parable',
  },

  // ── Daily life ───────────────────────────────────────────────────────────
  {
    id: 'd-peace-busy',
    text: 'How do I find peace in a busy day?',
    icon: '☕',
    category: 'daily-life',
  },
  {
    id: 'd-take-risk',
    text: 'Should I take that risk?',
    icon: '🎲',
    category: 'daily-life',
  },
  {
    id: 'd-exhausted',
    text: "I'm exhausted — what now?",
    icon: '🥱',
    category: 'daily-life',
  },
  {
    id: 'd-hard-conversation',
    text: 'I have a hard conversation coming up',
    icon: '💬',
    category: 'daily-life',
  },
  {
    id: 'd-decision-paralysis',
    text: "I can't decide and it's eating at me",
    icon: '🌀',
    category: 'daily-life',
  },

  // ── Big questions ────────────────────────────────────────────────────────
  {
    id: 'b-is-there-god',
    text: 'Is there really a God?',
    icon: '✨',
    category: 'big-questions',
  },
  {
    id: 'b-after-death',
    text: 'What happens when we die?',
    icon: '🌌',
    category: 'big-questions',
  },
  {
    id: 'b-why-evil',
    text: 'Why is there evil in the world?',
    icon: '🌑',
    category: 'big-questions',
  },
  {
    id: 'b-meaning-of-life',
    text: "What's the meaning of life?",
    icon: '🔭',
    category: 'big-questions',
  },
  {
    id: 'b-am-i-here',
    text: 'Why am I here?',
    icon: '🌍',
    category: 'big-questions',
  },

  // ── Feelings ─────────────────────────────────────────────────────────────
  {
    id: 'f-angry',
    text: "I'm so angry at someone",
    icon: '😤',
    category: 'feelings',
  },
  {
    id: 'f-alone',
    text: 'I feel completely alone',
    icon: '🕯️',
    category: 'feelings',
  },
  {
    id: 'f-overwhelmed',
    text: "I'm overwhelmed",
    icon: '🌊',
    category: 'feelings',
  },
  {
    id: 'f-anxious',
    text: 'How do I deal with anxiety?',
    icon: '🌬️',
    category: 'feelings',
  },
  {
    id: 'f-grieving',
    text: "I'm grieving someone I lost",
    icon: '🤍',
    category: 'feelings',
  },

  // ── Doubts ───────────────────────────────────────────────────────────────
  {
    id: 'x-not-believing',
    text: "I don't know if I believe anymore",
    icon: '🌫️',
    category: 'doubts',
  },
  {
    id: 'x-church-hurt',
    text: 'Religion has hurt people I love',
    icon: '⛪',
    category: 'doubts',
  },
  {
    id: 'x-unanswered-prayer',
    text: "Why doesn't God answer prayers?",
    icon: '🙏',
    category: 'doubts',
  },
  {
    id: 'x-science-vs-faith',
    text: 'Can I trust science and faith at the same time?',
    icon: '🔬',
    category: 'doubts',
  },
  {
    id: 'x-hypocrites',
    text: "What about the hypocrites who claim to follow you?",
    icon: '🎭',
    category: 'doubts',
  },
];

/**
 * Stable pseudo-random pick used by `getDailySuggestions`.
 *
 * Deterministic for a given (seed, index) pair — same UTC day always returns
 * the same selection on server and client.
 */
function pickIndex(seed: number, i: number, len: number): number {
  // Simple LCG-flavored mixer — keeps the math cheap and stable across runtimes.
  const mixed = (seed + 1) * (i + 1) * 31 + i * 7919;
  return Math.abs(mixed) % len;
}

/**
 * Deterministically picks a daily subset that tries to span categories.
 *
 * @param date  Defaults to today. Same UTC calendar day → same result.
 * @param count How many prompts to return. Default 5. Clamped to the pool size.
 */
export function getDailySuggestions(
  date?: Date,
  count: number = 5
): SuggestedPrompt[] {
  if (ALL_SUGGESTED_PROMPTS.length === 0) return [];

  const d = date ?? new Date();
  const seed = dayOfYear(d);
  const target = Math.max(0, Math.min(count, ALL_SUGGESTED_PROMPTS.length));
  if (target === 0) return [];

  // Group by category so we can round-robin across them for variety.
  const buckets = new Map<SuggestedPrompt['category'], SuggestedPrompt[]>();
  for (const p of ALL_SUGGESTED_PROMPTS) {
    const arr = buckets.get(p.category) ?? [];
    arr.push(p);
    buckets.set(p.category, arr);
  }

  // Stable category order rotated by the daily seed so the "first" category
  // shifts day-to-day. This prevents the same category always appearing first.
  const allCats = Array.from(buckets.keys());
  const rotation = seed % Math.max(1, allCats.length);
  const cats = [...allCats.slice(rotation), ...allCats.slice(0, rotation)];

  const chosenIds = new Set<string>();
  const result: SuggestedPrompt[] = [];
  let round = 0;

  // Round-robin across categories, picking one prompt per round until we
  // either fill `target` or exhaust the pool.
  while (result.length < target && chosenIds.size < ALL_SUGGESTED_PROMPTS.length) {
    let progressedThisRound = false;
    for (const cat of cats) {
      if (result.length >= target) break;
      const pool = buckets.get(cat) ?? [];
      if (pool.length === 0) continue;

      // Walk forward from a seeded start until we find one we haven't picked.
      const start = pickIndex(seed + round, cats.indexOf(cat), pool.length);
      for (let step = 0; step < pool.length; step++) {
        const candidate = pool[(start + step) % pool.length];
        if (!chosenIds.has(candidate.id)) {
          chosenIds.add(candidate.id);
          result.push(candidate);
          progressedThisRound = true;
          break;
        }
      }
    }
    if (!progressedThisRound) break;
    round++;
  }

  return result;
}
