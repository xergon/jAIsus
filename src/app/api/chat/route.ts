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
    system += `\n\nVISION — YOU CAN SEE THE USER RIGHT NOW:\nYou see: "${sceneDescription}"\nRules for vision comments:\n- MAX 1-2 sentences. Be BRIEF.\n- Be witty, teasing, playful. Roast them gently. Make them laugh.\n- Ask a cheeky question or make a joke about what you see.\n- Examples: "That posture would make a chiropractor weep.", "Are you eating AGAIN? I fasted 40 days, just saying.", "Is that your cat or did a furry demon sneak in?", "You've been staring at that screen so long I thought you were praying."\n- NEVER describe the scene like a robot. NEVER say "I can see..." — just react.\n- If the message is a parenthetical like "(observe...)", ONLY comment on what you see.`;
  }

  const result = streamText({
    model: anthropic('claude-haiku-4-5-20251001'),
    system,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: hasVision ? 100 : 300,
  });

  return result.toUIMessageStreamResponse();
}
