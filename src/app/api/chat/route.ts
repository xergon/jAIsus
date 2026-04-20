import { convertToModelMessages, streamText, UIMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { getPersonality, DEFAULT_PERSONALITY_ID } from '@/lib/personalities';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages, sceneDescription, personalityId }: {
    messages: UIMessage[];
    sceneDescription?: string;
    personalityId?: string;
  } = await req.json();

  const personality = getPersonality(personalityId || DEFAULT_PERSONALITY_ID);
  let system = personality.systemPrompt;
  const hasVision = !!sceneDescription;
  if (hasVision) {
    system += `\n\nVISION — YOU CAN SEE THE USER RIGHT NOW:\nYour divine eyes see this: "${sceneDescription}"\nPick ONE thing that stands out and make a short, natural comment (1-2 sentences max). React like a friend — "Nice place!", "You look tired", "Is that a cat?", etc. Do NOT list what you see or describe the scene. If the message is a parenthetical like "(observe...)", respond ONLY about what you see — keep it brief and punchy.`;
  }

  const result = streamText({
    model: anthropic('claude-haiku-4-5-20251001'),
    system,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: hasVision ? 100 : 300,
  });

  return result.toUIMessageStreamResponse();
}
