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
  if (sceneDescription) {
    system += `\n\nVISION — YOU CAN SEE THE USER RIGHT NOW:\nYour divine eyes see this: "${sceneDescription}"\nYou MUST comment on what you see. React naturally, like a friend who can see them. Examples: "Nice place you've got here", "Is that your friend next to you?", "You look tired, my child", "I see you're eating — enjoy your meal!", "That's a beautiful sunset behind you."\nDon't describe the scene robotically or list what you see. Just pick one thing that stands out and react to it warmly and naturally. If the user's message is just a parenthetical prompt like "(observe...)", respond ONLY about what you see — don't ask what they need help with.`;
  }

  const result = streamText({
    model: anthropic('claude-haiku-4-5-20251001'),
    system,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 300,
  });

  return result.toUIMessageStreamResponse();
}
