import { clientKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 15;

// Vision is auto-pinged by the client every N seconds while the camera is on,
// AND hits paid Gemini per call. Cap to 30-burst / 1-per-3s sustained so a
// scripted attacker can't loop-spam the endpoint to drain Gemini quota.
const VISION_LIMIT = { capacity: 30, refillRatePerSec: 1 / 3 };

// 2 MB of base64 = ~1.5 MB binary, plenty for a 640x480 JPEG at quality 0.7
// (typical: 30-80 KB). Caps a single-request CPU/cost spike.
const MAX_IMAGE_BASE64_LENGTH = 2_000_000;

const SCENE_PROMPT = `You are a witty divine observer with x-ray insight into human behavior. Describe what you see in this camera frame in 1-2 short sentences. Be funny, slightly ironic, and observational — like a comedian doing crowd work from heaven.

Focus on: the people (what they look like, what they're doing, their vibe), the setting, and anything amusing or notable.

Examples of the tone:
- "One guy staring at his phone like it owes him money. Couch, dim lighting, energy drink on the table. Classic late-night doom scroll."
- "Two humans pretending to work while clearly watching something on a laptop. Office vibes. The guilt is palpable."
- "Someone alone in a kitchen at what appears to be 2am. Fridge open. We've all been there."

Keep it SHORT (1-2 sentences max). Be playful, never mean. This description will be shown as a caption under a camera feed.`;

export async function POST(req: Request) {
  const rl = rateLimit(`vision:${clientKey(req)}`, VISION_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'Gemini API key not configured' }, { status: 500 });
  }

  try {
    let body: { image?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (typeof body.image !== 'string' || body.image.length === 0) {
      return Response.json({ error: 'No image provided' }, { status: 400 });
    }
    if (body.image.length > MAX_IMAGE_BASE64_LENGTH) {
      return Response.json({ error: 'Image too large' }, { status: 413 });
    }

    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,...").
    // Tolerate malformed prefixes — split[1] may be empty/undefined.
    //
    // Audit fix: validate that the data-URL prefix actually claims an image
    // type we accept AND that the body looks like base64. Previously we'd
    // forward anything ("data:application/pdf;base64,...", arbitrary bytes,
    // SVG with embedded scripts) to Gemini with a hardcoded `image/jpeg`
    // mime, wasting quota and routing non-images to a vision model.
    let mimeType = 'image/jpeg';
    let base64Data: string;
    if (body.image.includes(',')) {
      const match = body.image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.*)$/);
      if (!match) {
        return Response.json({ error: 'Unsupported image format' }, { status: 415 });
      }
      mimeType = match[1];
      base64Data = match[2] ?? '';
    } else {
      base64Data = body.image;
    }
    if (!base64Data) {
      return Response.json({ error: 'Empty image payload' }, { status: 400 });
    }
    // Reject anything that isn't a plausible base64 body. JSON serializing
    // and forwarding raw binary to Gemini is just burning quota on garbage.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Data)) {
      return Response.json({ error: 'Image payload is not valid base64' }, { status: 400 });
    }

    // Use Gemini REST API directly (avoids SDK base64 encoding issues).
    // Model: gemini-2.5-flash (current stable; previous 'gemini-3-flash-preview' didn't exist).
    // API key goes in x-goog-api-key header — NOT the URL query string — so it doesn't
    // leak into Google access logs, intermediate proxies, or our error traces.
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

    // Audit fix: wire req.signal so closing the client mid-request cancels the
    // upstream Gemini call instead of paying for a response no one waits for.
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
            { inlineData: { mimeType, data: base64Data } },
          ],
        }],
        // Audit fix: bound the output. The scene caption is meant to be 1-2
        // short sentences; without a cap, a model glitch or adversarial
        // frame could produce thousands of tokens of billed output. 120
        // tokens is generous for two sentences.
        generationConfig: { maxOutputTokens: 120 },
      }),
      signal: req.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Gemini API error:', response.status, errorBody.slice(0, 200));
      // Don't leak upstream error body to client — could expose key fragments, quota details, etc.
      return Response.json({ error: 'Vision analysis failed' }, { status: 500 });
    }

    const data = await response.json();
    const description = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Audit follow-up: when Gemini blocks for SAFETY (promptFeedback.blockReason),
    // we used to silently return empty — surface a hint so the UI can react.
    if (!description && data?.promptFeedback?.blockReason) {
      return Response.json({ description: '', blocked: true });
    }
    return Response.json({ description });
  } catch (err) {
    // AbortError = client closed the connection, normal — don't log noise.
    if ((err as Error)?.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Vision API error:', errMsg);
    // Don't leak error details to client
    return Response.json({ error: 'Vision analysis failed' }, { status: 500 });
  }
}
