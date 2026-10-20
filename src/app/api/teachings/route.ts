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

  // Defensive parse — matches chat/tts/vision/summarize routes.
  // Previously: malformed body threw a raw 500 with a stack trace.
  let body: { topic?: unknown };
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

  // Use Haiku 4.5 (same as chat route — verified working).
  // Previous model ID 'claude-sonnet-4-6' didn't exist and broke this endpoint.
  // Haiku is plenty for the teaching format and ~5x cheaper than Sonnet.
  try {
    const { text } = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      // Perf audit fix: TEACHING_PROMPT is a large stable system prompt
      // hit repeatedly (once per burst-limited topic). Cache it with
      // Anthropic's ephemeral cache — same treatment /api/chat gives the
      // personality prompt. First hit warms it; every subsequent request
      // in the 5-minute window pays only for the topic delta.
      messages: [
        {
          role: 'system',
          content: TEACHING_PROMPT,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        },
        { role: 'user', content: `Generate a spiritual teaching about: ${topic}` },
      ],
      // Audit fix: stop billing for the generation when the client hangs up.
      // Teachings are the longest-form Anthropic call in the app.
      abortSignal: req.signal,
    });
    return Response.json({ teaching: text });
  } catch (err) {
    console.error('Teaching generation failed:', err instanceof Error ? err.message : String(err));
    return Response.json({ error: 'Teaching generation failed' }, { status: 500 });
  }
}
