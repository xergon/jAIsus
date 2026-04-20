import { convertToModelMessages, streamText, UIMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { xai } from '@ai-sdk/xai';
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
  // Detect if this is an auto-vision ping (parenthetical message)
  const lastMsg = messages[messages.length - 1];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastText = lastMsg?.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') || '';
  const isVisionPing = lastText.startsWith('(') && lastText.endsWith(')');
  const hasVision = !!sceneDescription;

  if (hasVision) {
    if (isVisionPing) {
      // Override the entire system prompt for vision pings — force extreme brevity
      system = `You are observing someone through a camera. You see: "${sceneDescription}"

RESPOND WITH EXACTLY ONE SHORT SENTENCE. Maximum 15 words. Be witty, cheeky, or funny. Examples:
- "That posture would make a chiropractor weep."
- "Are you eating AGAIN? I fasted 40 days, just saying."
- "Is that your cat or a furry demon?"
- "You've been staring at that screen so long I thought you were praying."

DO NOT monologue. DO NOT philosophize. DO NOT be sentimental. ONE sentence, make it count.`;
    } else {
      system += `\n\n[You can see the user right now: "${sceneDescription}" — you may briefly reference what you see, but focus on answering their question.]`;
    }
  }

  // Pick model based on personality provider
  const model = personality.provider === 'grok'
    ? xai('grok-3-mini-fast')
    : anthropic('claude-haiku-4-5-20251001');

  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: isVisionPing ? 60 : 300,
  });

  return result.toUIMessageStreamResponse();
}
