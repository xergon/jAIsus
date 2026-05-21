import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { TEACHING_PROMPT } from '@/lib/system-prompt';
import { clientKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 30;

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

export async function POST(req: Request) {
  const rl = rateLimit(`teachings:${clientKey(req)}`, TEACHING_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  const { topic }: { topic: string } = await req.json();

  // Validate against allowlist — prevents abuse via crafted topics that
  // could waste tokens or attempt prompt injection.
  if (typeof topic !== 'string' || !ALLOWED_TOPICS.has(topic.toLowerCase())) {
    return Response.json({ error: 'Invalid topic' }, { status: 400 });
  }

  // Use Haiku 4.5 (same as chat route — verified working).
  // Previous model ID 'claude-sonnet-4-6' didn't exist and broke this endpoint.
  // Haiku is plenty for the teaching format and ~5x cheaper than Sonnet.
  const { text } = await generateText({
    model: anthropic('claude-haiku-4-5-20251001'),
    system: TEACHING_PROMPT,
    prompt: `Generate a spiritual teaching about: ${topic}`,
  });

  return Response.json({ teaching: text });
}
