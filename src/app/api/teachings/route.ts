import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { xai } from '@ai-sdk/xai';
import { deepseek } from '@ai-sdk/deepseek';
import { TEACHING_PROMPT } from '@/lib/system-prompt';
import { PERSONALITIES, SAFETY_RULES, SHARED_TEACHING_RULES, type Personality } from '@/lib/personalities';
import { clientKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

// 60, not 30: a 300-400 word teaching on DeepSeek (some personas) can take
// 20+ seconds, and generateText waits for all of it.
export const maxDuration = 60;

// Teachings are expensive (longer generations) — tighter budget than chat.
// 5 teachings in a burst, refilling 1 per minute. Plenty for normal use,
// stops anyone trying to drain the budget by hammering this endpoint.
const TEACHING_LIMIT = { capacity: 5, refillRatePerSec: 1 / 60 };

// Hardcoded topic allowlist mirrors TEACHING_TOPICS in src/lib/constants.ts.
// Kept here (not imported) so this route stays decoupled from client constants
// and to prevent any future drift from accidentally allowing arbitrary topics.
// IMPORTANT: keep this in sync with TEACHING_TOPICS — if you add a topic there,
// add it here too. The client never sends a topic outside this list under
// normal flow, but the server is the source of truth and trusts no client.
const ALLOWED_TOPICS = new Set([
  'love', 'forgiveness', 'faith', 'hope',
  'patience', 'gratitude', 'compassion', 'wisdom',
  'peace', 'courage', 'joy', 'grief',
  'identity', 'calling', 'surrender', 'friendship',
]);

// Same cap /api/chat applies to an inline custom personality's prompts.
const MAX_INLINE_PROMPT = 2000;

/**
 * The teaching prompt and provider for the active personality, so a teaching
 * sounds like the persona whose voice reads it. Built-ins resolve by id;
 * user-authored ('custom-…') ones arrive inline, validated like in /api/chat.
 * Missing, unknown or invalid → the original Mushroom Guru TEACHING_PROMPT
 * (never a 400, so older clients that send only the topic keep working).
 *
 * SAFETY_RULES goes last on every prompt, as SHARED_RULES does in chat. Not
 * SHARED_RULES itself: its [EMOTION:tag] rule would put tags in a teaching
 * that is shown and spoken raw.
 */
function resolveTeaching(personalityId: unknown, customPersonality: unknown): {
  prompt: string;
  provider: Personality['provider'];
} {
  if (typeof personalityId === 'string' && personalityId.startsWith('custom-')) {
    const c = (customPersonality && typeof customPersonality === 'object')
      ? customPersonality as Record<string, unknown>
      : null;
    const valid =
      !!c &&
      c.id === personalityId &&
      typeof c.name === 'string' && c.name.length > 0 &&
      typeof c.systemPrompt === 'string' && c.systemPrompt.length >= 40 &&
      typeof c.voiceId === 'string' && c.voiceId.length > 0;
    if (valid) {
      const own = typeof c.teachingPrompt === 'string' && c.teachingPrompt.trim()
        ? c.teachingPrompt
        : c.systemPrompt as string;
      // toWellFormed: the cap can cut an emoji in half (Anthropic 400s on that).
      const userPrompt = own.slice(0, MAX_INLINE_PROMPT).toWellFormed();
      // User-authored prompts always run on Claude, as in chat.
      return { prompt: userPrompt + SHARED_TEACHING_RULES + SAFETY_RULES, provider: 'claude' };
    }
  } else if (typeof personalityId === 'string') {
    const builtin = PERSONALITIES.find(p => p.id === personalityId);
    if (builtin) return { prompt: builtin.teachingPrompt + SAFETY_RULES, provider: builtin.provider };
  }
  return { prompt: TEACHING_PROMPT + SAFETY_RULES, provider: 'claude' };
}

export async function POST(req: Request) {
  const rl = rateLimit(`teachings:${clientKey(req)}`, TEACHING_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  // Defensive parse — matches chat/tts/vision/summarize routes.
  // Previously: malformed body threw a raw 500 with a stack trace.
  let body: { topic?: unknown; personalityId?: unknown; customPersonality?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const topic = typeof body.topic === 'string' ? body.topic : '';

  // Validate against allowlist — prevents abuse via crafted topics that
  // could waste tokens or attempt prompt injection.
  if (!topic || !ALLOWED_TOPICS.has(topic.toLowerCase())) {
    return Response.json({ error: 'Invalid topic' }, { status: 400 });
  }

  const { prompt, provider } = resolveTeaching(body.personalityId, body.customPersonality);

  // Same model per provider as /api/chat, so personas that run on Grok or
  // DeepSeek in chat aren't toned down (or refused) by Claude here.
  // Claude: Haiku 4.5 (verified working; ~5x cheaper than Sonnet).
  // Previous model ID 'claude-sonnet-4-6' didn't exist and broke this endpoint.
  const model = provider === 'deepseek'
    ? deepseek('deepseek-chat')
    : provider === 'grok'
      ? xai('grok-3-mini-fast')
      : anthropic('claude-haiku-4-5-20251001');

  const generate = (m: typeof model, cache: boolean) => generateText({
    model: m,
    // Perf audit fix: the teaching prompt is a large stable system prompt
    // hit repeatedly (once per burst-limited topic). Cache it with
    // Anthropic's ephemeral cache — same treatment /api/chat gives the
    // personality prompt. First hit warms it; every subsequent request
    // in the 5-minute window pays only for the topic delta.
    messages: [
      {
        role: 'system',
        content: prompt,
        ...(cache && {
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        }),
      },
      { role: 'user', content: `Generate a spiritual teaching about: ${topic}` },
    ],
    // Audit fix: stop billing for the generation when the client hangs up.
    // Teachings are the longest-form Anthropic call in the app.
    abortSignal: req.signal,
  });

  try {
    let text: string;
    try {
      ({ text } = await generate(model, provider === 'claude'));
    } catch (err) {
      // Grok/DeepSeek down or its key missing: fall back to Claude rather
      // than failing the teaching (they all ran on Claude before).
      if (provider === 'claude' || req.signal.aborted) throw err;
      console.warn('Teaching provider failed, retrying on Claude:', err instanceof Error ? err.message : String(err));
      ({ text } = await generate(anthropic('claude-haiku-4-5-20251001'), true));
    }
    // An empty generation is a failure, not a blank teaching.
    if (!text.trim()) {
      console.error('Teaching generation returned no text');
      return Response.json({ error: 'Teaching generation failed' }, { status: 500 });
    }
    return Response.json({ teaching: text });
  } catch (err) {
    console.error('Teaching generation failed:', err instanceof Error ? err.message : String(err));
    return Response.json({ error: 'Teaching generation failed' }, { status: 500 });
  }
}
