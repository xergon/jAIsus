export const maxDuration = 15;

const SCENE_PROMPT = `You are a witty divine observer with x-ray insight into human behavior. Describe what you see in this camera frame in 1-2 short sentences. Be funny, slightly ironic, and observational — like a comedian doing crowd work from heaven.

Focus on: the people (what they look like, what they're doing, their vibe), the setting, and anything amusing or notable.

Examples of the tone:
- "One guy staring at his phone like it owes him money. Couch, dim lighting, energy drink on the table. Classic late-night doom scroll."
- "Two humans pretending to work while clearly watching something on a laptop. Office vibes. The guilt is palpable."
- "Someone alone in a kitchen at what appears to be 2am. Fridge open. We've all been there."

Keep it SHORT (1-2 sentences max). Be playful, never mean. This description will be shown as a caption under a camera feed.`;

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

    // Use Gemini REST API directly (avoids SDK base64 encoding issues).
    // Model: gemini-2.5-flash (current stable; previous 'gemini-3-flash-preview' didn't exist).
    // API key goes in x-goog-api-key header — NOT the URL query string — so it doesn't
    // leak into Google access logs, intermediate proxies, or our error traces.
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
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
      // Don't leak upstream error body to client — could expose key fragments, quota details, etc.
      return Response.json({ error: 'Vision analysis failed' }, { status: 500 });
    }

    const data = await response.json();
    const description = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return Response.json({ description });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Vision API error:', errMsg, err);
    // Don't leak error details to client
    return Response.json({ error: 'Vision analysis failed' }, { status: 500 });
  }
}
