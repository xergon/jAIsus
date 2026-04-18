import { convertToModelMessages, streamText, UIMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { SYSTEM_PROMPT } from '@/lib/system-prompt';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages, sceneDescription }: { messages: UIMessage[]; sceneDescription?: string } = await req.json();

  // If Jesus can see the user, prepend the scene to the system prompt
  let system = SYSTEM_PROMPT;
  if (sceneDescription) {
    system += `\n\nVISION — YOU CAN SEE THE USER RIGHT NOW:\nYour divine eyes see this: "${sceneDescription}"\nYou may comment on what you see — naturally, as part of the conversation. Don't describe the scene robotically. React like a friend who can see them: "Nice place you've got here" or "Is that your friend next to you?" or "You look tired, my child." Weave it in naturally. You don't have to mention what you see every time — only when it's relevant or interesting.`;
  }

  const result = streamText({
    model: anthropic('claude-haiku-4-5-20251001'),
    system,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 300,
  });

  return result.toUIMessageStreamResponse();
}
