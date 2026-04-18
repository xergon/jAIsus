import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 15;

const SCENE_PROMPT = `You are the eyes of Jesus Christ. Describe what you see in this camera frame in 1-2 short sentences, focusing on:
- The people: how many, what they look like, what they're doing, their expressions/mood
- The setting: indoors/outdoors, time of day, notable objects
- The vibe: are they happy, bored, partying, working, eating, relaxing?

Be concise and observational, like quick notes. Example: "Two friends sitting on a couch laughing, one holding a phone. Living room, evening, warm lamp light. They look relaxed and happy."

Do NOT moralize or comment. Just describe what you see factually.`;

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'Gemini API key not configured' }, { status: 500 });
  }

  try {
    const { image }: { image: string } = await req.json();
    if (!image) {
      return Response.json({ error: 'No image provided' }, { status: 400 });
    }

    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,...")
    const base64Data = image.includes(',') ? image.split(',')[1] : image;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent([
      SCENE_PROMPT,
      {
        inlineData: {
          data: base64Data,
          mimeType: 'image/jpeg',
        },
      },
    ]);

    const description = result.response.text();
    return Response.json({ description });
  } catch (err) {
    console.error('Vision API error:', err);
    return Response.json({ error: 'Vision analysis failed' }, { status: 500 });
  }
}
