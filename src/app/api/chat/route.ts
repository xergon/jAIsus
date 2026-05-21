import { convertToModelMessages, streamText, UIMessage, ModelMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { xai } from '@ai-sdk/xai';
import { deepseek } from '@ai-sdk/deepseek';
import { getPersonality, DEFAULT_PERSONALITY_ID } from '@/lib/personalities';
import { clientKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 30;

interface UIMessagePart { type: string; text?: string }

// Chat is the primary endpoint; allow generous bursts for natural conversation
// but cap steady-state to prevent budget abuse. 30 req burst, 1 req/sec sustained
// allows for normal back-and-forth voice chat (a turn every 2-3s) while stopping
// scripted abuse.
const CHAT_LIMIT = { capacity: 30, refillRatePerSec: 1 };

// Cap conversation history sent to Anthropic. Users with VERY long sessions
// would otherwise pay for re-sending all messages every turn — Anthropic
// charges per input token. 60 messages = ~30 user turns, plenty of context
// for jAIsus to reference recent exchanges. Beyond that, prompt caching +
// the conversation-memory summaries fill the gap.
const MAX_MESSAGES = 60;

// Per-message text cap — defensive against a single absurdly long message
// being pasted in.
const MAX_MESSAGE_TEXT = 8000;

export async function POST(req: Request) {
  const rl = rateLimit(`chat:${clientKey(req)}`, CHAT_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  // Parse body defensively — malformed JSON used to throw a raw 500.
  let body: {
    messages?: unknown;
    sceneDescription?: unknown;
    personalityId?: unknown;
    memoryContext?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return Response.json({ error: 'messages must be an array' }, { status: 400 });
  }

  // Truncate to last MAX_MESSAGES; per-message text capped too.
  // Cast through unknown to avoid bleeding the untyped body into the AI SDK call.
  const messages = (body.messages as UIMessage[])
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      ...m,
      parts: m.parts?.map((p) =>
        p.type === 'text' && typeof (p as { text: unknown }).text === 'string'
          ? { ...p, text: ((p as { text: string }).text).slice(0, MAX_MESSAGE_TEXT) }
          : p
      ),
    })) as UIMessage[];

  const sceneDescription = typeof body.sceneDescription === 'string' ? body.sceneDescription : undefined;
  const personalityId = typeof body.personalityId === 'string' ? body.personalityId : undefined;
  const memoryContext = typeof body.memoryContext === 'string' ? body.memoryContext : undefined;

  // Defensive cap — never trust client-side length. 4000 chars is plenty for
  // ~5 short summaries with formatting; anything longer is either noise or
  // a malformed request. Truncate (don't 400) so the rest of the request
  // still works.
  const safeMemoryContext = memoryContext
    ? memoryContext.slice(0, 4000)
    : '';

  const personality = getPersonality(personalityId || DEFAULT_PERSONALITY_ID);
  // Detect if this is an auto-vision ping (parenthetical message)
  const lastMsg = messages[messages.length - 1];
  const lastText = lastMsg?.parts
    ?.filter((p: UIMessagePart) => p.type === 'text')
    .map((p: UIMessagePart) => p.text ?? '')
    .join('') || '';
  const isVisionPing = lastText.startsWith('(') && lastText.endsWith(')');
  const hasVision = !!sceneDescription;
  const isClaude = personality.provider === 'claude';

  // Build the system message(s).
  //
  // Strategy: keep the (large, stable) personality prompt as a SEPARATE message
  // from the (small, request-varying) scene context. For Claude this lets us
  // mark the personality prompt with cache_control: ephemeral — Anthropic
  // caches it on the first hit and re-serves it for ~5min at ~10% the cost
  // of the original tokens. The scene context, which changes every camera
  // capture, is kept uncached.
  //
  // For vision pings (parenthetical auto-prompts), we override entirely with
  // a constrained one-shot system since the cache would miss anyway.
  const systemMessages: ModelMessage[] = [];

  if (hasVision && isVisionPing) {
    systemMessages.push({
      role: 'system',
      content: `You are observing someone through a camera. You see: "${sceneDescription}"

RESPOND WITH EXACTLY ONE SHORT SENTENCE. Maximum 15 words. Be witty, cheeky, or funny. Examples:
- "That posture would make a chiropractor weep."
- "Are you eating AGAIN? I fasted 40 days, just saying."
- "Is that your cat or a furry demon?"
- "You've been staring at that screen so long I thought you were praying."

DO NOT monologue. DO NOT philosophize. DO NOT be sentimental. ONE sentence, make it count.`,
    });
  } else {
    // Personality prompt — cache for Claude (stable across requests for a given personality)
    systemMessages.push({
      role: 'system',
      content: personality.systemPrompt,
      ...(isClaude && {
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      }),
    });
    // Memory context — recent conversation summaries injected after the cached
    // personality prompt so the cache prefix stays stable. NOT cached itself,
    // since the memory set changes per request. For Claude this means the
    // breakpoint above remains valid; for non-Claude providers it's just a
    // plain system message appended in order.
    if (safeMemoryContext && safeMemoryContext.trim().length > 0) {
      systemMessages.push({
        role: 'system',
        content: safeMemoryContext,
      });
    }
    // Scene context — separate, uncached (varies per camera capture)
    if (hasVision) {
      systemMessages.push({
        role: 'system',
        content: `[You can see the user right now: "${sceneDescription}" — you may briefly reference what you see, but focus on answering their question.]`,
      });
    }
  }

  // Pick model based on personality provider
  const model = personality.provider === 'deepseek'
    ? deepseek('deepseek-chat')
    : personality.provider === 'grok'
      ? xai('grok-3-mini-fast')
      : anthropic('claude-haiku-4-5-20251001');

  const result = streamText({
    model,
    messages: [...systemMessages, ...(await convertToModelMessages(messages))],
    maxOutputTokens: isVisionPing ? 60 : 300,
  });

  return result.toUIMessageStreamResponse();
}
