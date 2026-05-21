import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { TEACHING_PROMPT } from '@/lib/system-prompt';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { topic }: { topic: string } = await req.json();

  // Use Haiku 4.5 (same as chat route — verified working).
  // Previous model ID 'claude-sonnet-4-6' didn't exist and broke this endpoint.
  // Haiku is plenty for the teaching format and ~5x cheaper than Sonnet.
  const { text } = await generateText({
    model: anthropic('claude-haiku-4-5-20251001'),
    system: TEACHING_PROMPT,
    prompt: `Generate a spiritual teaching about: ${topic}`,
  });

  return Response.json({ teaching: text });
}
