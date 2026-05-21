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

export async function POST(req: Request) {
  const rl = rateLimit(`chat:${clientKey(req)}`, CHAT_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  const { messages, sceneDescription, personalityId }: {
    messages: UIMessage[];
    sceneDescription?: string;
    personalityId?: string;
  } = await req.json();

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
