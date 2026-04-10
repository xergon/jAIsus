import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { TEACHING_PROMPT } from '@/lib/system-prompt';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { topic }: { topic: string } = await req.json();

  const { text } = await generateText({
    model: anthropic('claude-sonnet-4-6-20250627'),
    system: TEACHING_PROMPT,
    prompt: `Generate a spiritual teaching about: ${topic}`,
  });

  return Response.json({ teaching: text });
}
