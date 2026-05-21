/**
 * POST /api/summarize
 *
 * Generates a single-sentence summary of a conversation via Claude Haiku.
 * Called by useConversationMemory.summarizeAndSave when a chat session ends.
 *
 * Request:  { messages: Array<{ role: string; text: string }> }
 * Response: { summary: string }   — empty string on LLM failure (200 OK)
 *           { error: string }     — 400 on malformed input
 *           Rate-limit response   — 429 with Retry-After
 *
 * This endpoint fires at most once per session-end, so it's tuned for a low
 * sustained rate (one per 15s) with a small burst capacity for tab-juggling.
 */

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { clientKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 15;

// Fires once per session end (clear history, etc.) — not chatty.
// Burst 20 covers rapid tab/personality switches; 1/15s sustained is plenty.
const SUMMARIZE_LIMIT = { capacity: 20, refillRatePerSec: 1 / 15 };

/** Cap on combined input text. Most recent 8000 chars wins (recency bias). */
const MAX_INPUT_CHARS = 8000;

const SYSTEM_PROMPT =
  "Summarize the conversation below in ONE sentence (max 20 words). " +
  "Focus on the theme or question, not the exchange. Speak in past tense " +
  "from the user's perspective. Example: 'You asked about forgiving " +
  "someone who hurt you and we explored the Prodigal Son.' No quotes, " +
  "no preamble.";

interface IncomingMessage {
  role: string;
  text: string;
}

/** Type guard: validate the request body is the shape we expect. */
function isValidMessages(value: unknown): value is IncomingMessage[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    m =>
      m &&
      typeof m === 'object' &&
      typeof (m as { role?: unknown }).role === 'string' &&
      typeof (m as { text?: unknown }).text === 'string'
  );
}

/**
 * Format messages as "User: ...\njAIsus: ...\n..." for the model.
 * Non-user roles all map to "jAIsus" (assistant is the only other expected
 * role; system messages, if any sneak through, get labeled the same way —
 * the model doesn't need finer distinction for a one-sentence summary).
 */
function formatMessages(messages: IncomingMessage[]): string {
  return messages
    .map(m => {
      const label = m.role === 'user' ? 'User' : 'jAIsus';
      return `${label}: ${m.text}`;
    })
    .join('\n');
}

/**
 * Truncate from the FRONT so the most recent context survives — the end of
 * a conversation is the most relevant part for a summary.
 */
function truncateTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(req: Request) {
  const rl = rateLimit(`summarize:${clientKey(req)}`, SUMMARIZE_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const messages = (body as { messages?: unknown })?.messages;
  if (!isValidMessages(messages)) {
    return jsonResponse(
      { error: 'Expected { messages: Array<{ role: string; text: string }> }' },
      400
    );
  }
  if (messages.length === 0) {
    return jsonResponse({ summary: '' });
  }

  const transcript = truncateTail(formatMessages(messages), MAX_INPUT_CHARS);

  try {
    const result = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      prompt: transcript,
      maxOutputTokens: 80,
    });

    const summary = (result.text ?? '').trim();
    return jsonResponse({ summary });
  } catch (err) {
    // Log for ops but never bubble details — the caller silently no-ops on
    // empty summaries, so a 200 with empty string is the graceful failure mode.
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Summarize API error:', errMsg);
    return jsonResponse({ summary: '' });
  }
}
