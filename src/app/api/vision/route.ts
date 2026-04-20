export const maxDuration = 15;

const SCENE_PROMPT = `You are the eyes of Jesus Christ. Describe what you see in this camera frame in 1-2 short sentences, focusing on:
- The people: how many, what they look like, what they're doing, their expressions/mood
- The setting: indoors/outdoors, time of day, notable objects
- The vibe: are they happy, bored, partying, working, eating, relaxing?

Be concise and observational, like quick notes. Example: "Two friends sitting on a couch laughing, one holding a phone. Living room, evening, warm lamp light. They look relaxed and happy."

Do NOT moralize or comment. Just describe what you see factually.`;

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
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

    // Use Gemini REST API directly (avoids SDK base64 encoding issues)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: SCENE_PROMPT },
            { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Gemini API error:', response.status, errorBody);
      return Response.json({ error: 'Vision analysis failed', details: errorBody }, { status: 500 });
    }

    const data = await response.json();
    const description = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return Response.json({ description });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Vision API error:', errMsg, err);
    return Response.json({ error: 'Vision analysis failed', details: errMsg }, { status: 500 });
  }
}
